import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	acepeShellPingScript,
	appBundlePathFromExecutable,
	applyNativeWrapperCwdOrExit,
	describeJsonSafety,
	downloadProgressFromStatus,
	joinPathSegments,
	qaSurfaceEnabled,
	RPC_ROUNDTRIP_MESSAGE,
	RPC_ROUNDTRIP_PREFIX,
	readDevWindowUrl,
	relaunchCommand,
	resolveElectrobunConfig,
	SHELL_PROOF_LOG_PATH,
	SHELL_STARTUP_FAILED_PREFIX,
	type ShellUpdateDownloadProgress,
	type ShellUpdaterPort,
	startElectrobunAcepeApp,
} from "@acepe/electrobun-shell";
import { makeAcepeLive } from "@acepe/server/bootstrap";
import {
	encodedAgentCall,
	encodedDispatch,
	encodedGetDefaultShell,
	encodedGetProjectIndex,
	encodedGetProviderAccountUsage,
	encodedGitCall,
	encodedImportProviderSession,
	encodedInvalidateProjectIndex,
	encodedListProviderProjects,
	encodedListProviderSessions,
	encodedReadImageDataUrl,
	encodedReadTextFile,
	encodedSnapshot,
	encodedWriteTextFile,
	pushEvents,
} from "@acepe/server/rpc/encodedBoundary";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { loadQaSocketPath, qaPreloadScript } from "electrobun-qa";
import { standardApplicationMenu } from "./application-menu.ts";
import { keepQaHost, qaInternalMessageMap, qaWindowPreload } from "./qa-host.ts";
import { makeSupersedingEventsHandler } from "./superseding-events.ts";
import {
	migrateLegacyTracerDb,
	resolveTracerDbPath,
	TRACER_APP_ID,
	tracerDbFilename,
} from "./tracer-db-path.ts";

// AC-271: the tracer DB used to resolve to a bare filename next to the
// launcher executable, inside the app bundle -- `electrobun:build` recreates
// that directory on every build, silently wiping the user's real projects
// and sessions. It now resolves under the OS app-data directory instead
// (see tracer-db-path.ts), and migrates a pre-fix bundle-local DB into that
// location on first run so nobody loses history to this fix itself. One
// instance key (ELECTROBUN_QA_APP_ID) scopes the QA socket and this DB
// filename, so parallel app instances never share a DB file.
const loadTracerDbPath = Effect.fn("loadTracerDbPath")(function* () {
	const instance = yield* Config.string("APP_ID").pipe(
		Config.nested("ELECTROBUN_QA"),
		Config.withDefault("")
	);
	const home = yield* Config.string("HOME").pipe(
		Config.orElse(() => Config.string("USERPROFILE")),
		Config.withDefault("")
	);
	const targetPath = resolveTracerDbPath({
		platform: process.platform,
		home,
		appId: TRACER_APP_ID,
		instance,
		appDataEnv: process.env.APPDATA,
		xdgDataHome: process.env.XDG_DATA_HOME,
	});
	// The native wrapper cwd shim (applyNativeWrapperCwdOrExit, called
	// before this runs) chdir's into the bundle's launcher directory
	// (Contents/MacOS on macOS) -- that is exactly where the pre-fix code
	// used to open the bare filename, so process.cwd() here reproduces that
	// legacy path exactly, for any instance.
	const legacyPath = `${process.cwd()}/${tracerDbFilename(instance)}`;
	const migration = migrateLegacyTracerDb({
		legacyPath,
		targetPath,
		targetDir: dirname(targetPath),
		exists: existsSync,
		mkdirSync: (dir) => mkdirSync(dir, { recursive: true }),
		copyFileSync,
	});
	return { targetPath, legacyPath, migration };
});

const PROOF_LOG = SHELL_PROOF_LOG_PATH;
const RPC_ROUNDTRIP_WAIT_MS = 20_000;

writeFileSync(PROOF_LOG, "");

const writeLine = (line: string): void => {
	process.stderr.write(`${line}\n`);
	appendFileSync(PROOF_LOG, `${line}\n`);
};

process.title = "Acepe";

applyNativeWrapperCwdOrExit({
	cwd: process.cwd(),
	bunEntrypointDir: import.meta.dir,
	execPathDir: joinPathSegments(process.execPath, [".."]),
	exists: (path) => existsSync(path),
	chdir: (path) => {
		process.chdir(path);
	},
	writeError: writeLine,
	exit: (code) => process.exit(code),
});

const electrobun = await import("electrobun/bun");
const electrobunNative = await import("../../node_modules/electrobun/dist/api/bun/proc/native.ts");

// Without this macOS has no menu bar and therefore no key equivalents at all:
// Cmd+Q, Cmd+A, copy/paste and undo are menu accelerators, not webview
// behavior. See application-menu.ts.
electrobun.ApplicationMenu.setApplicationMenu(standardApplicationMenu());

const qaConfig = resolveElectrobunConfig();
const qaEnabled = qaSurfaceEnabled(qaConfig);

const tracerDb = Effect.runSync(loadTracerDbPath());
writeLine(
	`acepe-tracer-db: path=${tracerDb.targetPath} migration=${tracerDb.migration} legacyPath=${tracerDb.legacyPath}`
);

const runtime = ManagedRuntime.make(
	makeAcepeLive({
		filename: tracerDb.targetPath,
		tokenDelay: Duration.millis(40),
		voiceQaSurfaceEnabled: qaEnabled,
	})
);

let sawRpcRoundtrip = false;

// Electrobun's Updater is a process-wide singleton: it reads version.json out
// of the app bundle, fetches the channel manifest, and swaps the bundle in
// place. The shell hands the webview a port onto it, so the webview never
// carries a second updater of its own.
const acepeUpdaterPort: ShellUpdaterPort = {
	localInfo: async () => {
		const info = await electrobun.Updater.getLocalInfo();
		return { version: info.version, channel: info.channel };
	},
	checkForUpdate: async () => {
		const check = await electrobun.Updater.checkForUpdate();
		return {
			version: check.version,
			updateAvailable: check.updateAvailable,
			error: check.error,
		};
	},
	downloadUpdate: async () => {
		await electrobun.Updater.downloadUpdate();
	},
	applyUpdate: async () => {
		await electrobun.Updater.applyUpdate();
	},
	relaunch: () => {
		const appBundlePath = appBundlePathFromExecutable(process.execPath);
		if (appBundlePath === null) {
			throw new Error(`no app bundle around ${process.execPath}`);
		}
		Bun.spawn(relaunchCommand({ pid: process.pid, appBundlePath }).slice(), {
			stdio: ["ignore", "ignore", "ignore"],
		});
		electrobun.Utils.quit();
	},
	onDownloadProgress: (listener: (progress: ShellUpdateDownloadProgress) => void) => {
		electrobun.Updater.onStatusChange((entry) => {
			const progress = downloadProgressFromStatus(entry);
			if (progress !== null) {
				listener(progress);
			}
		});
	},
};

const launched = startElectrobunAcepeApp(
	{
		defineRPC: (input) =>
			electrobun.BrowserView.defineRPC({
				maxRequestTime: input.maxRequestTime,
				handlers: {
					requests: input.handlers.requests,
					messages: input.handlers.messages,
				},
			}),
		BrowserWindow: electrobun.BrowserWindow,
		setDockIconVisible: electrobun.Utils.setDockIconVisible,
		updater: acepeUpdaterPort,
	},
	{
		writeError: (line) => {
			if (line.startsWith(`${RPC_ROUNDTRIP_PREFIX}:`) === true) {
				sawRpcRoundtrip = true;
			}
			writeLine(line);
		},
		exit: (code) => process.exit(code),
	},
	{
		preload: qaWindowPreload(qaEnabled, qaPreloadScript),
		devUrl: readDevWindowUrl(process.env.ACEPE_DEV_URL),
	}
);

// One window, one events subscription: a page reload requests `events` again,
// and the previous push fiber must not keep feeding the same window channel
// (see superseding-events.ts's header for the leak this repairs).
const handleEventsRequest = makeSupersedingEventsHandler(
	(effect) => runtime.runFork(effect),
	(params) =>
		pushEvents(params, (payload) => {
			// acepe#261 diagnostic: prove the payload handed to sendEvents is
			// JSON-safe (both electrobun transport fallbacks silently drop
			// anything JSON.stringify can't serialize) before it leaves bun.
			const { jsonSafe, jsonLength } = describeJsonSafety(payload);
			writeLine(
				`acepe-events-stream: push type=${typeof payload} jsonSafe=${jsonSafe} jsonLength=${jsonLength}`
			);
			launched.sendEvents(payload);
		})
);

launched.attach({
	dispatch: (params) => runtime.runPromise(encodedDispatch(params)),
	snapshot: (params) => runtime.runPromise(encodedSnapshot(params)),
	getProjectIndex: (params) => runtime.runPromise(encodedGetProjectIndex(params)),
	invalidateProjectIndex: (params) => runtime.runPromise(encodedInvalidateProjectIndex(params)),
	readTextFile: (params) => runtime.runPromise(encodedReadTextFile(params)),
	readImageDataUrl: (params) => runtime.runPromise(encodedReadImageDataUrl(params)),
	writeTextFile: (params) => runtime.runPromise(encodedWriteTextFile(params)),
	getDefaultShell: (params) => runtime.runPromise(encodedGetDefaultShell(params)),
	gitCall: (params) => runtime.runPromise(encodedGitCall(params)),
	agentCall: (params) => runtime.runPromise(encodedAgentCall(params)),
	getProviderAccountUsage: (params) => runtime.runPromise(encodedGetProviderAccountUsage(params)),
	listProviderSessions: (params) => runtime.runPromise(encodedListProviderSessions(params)),
	listProviderProjects: (params) => runtime.runPromise(encodedListProviderProjects(params)),
	importProviderSession: (params) => runtime.runPromise(encodedImportProviderSession(params)),
	events: (params) => {
		writeLine(`acepe-events-stream: requested ${JSON.stringify(params).slice(0, 80)}`);
		return handleEventsRequest(params);
	},
});

if (qaEnabled === true) {
	const qaSocket = Effect.runSync(loadQaSocketPath());
	writeLine(`acepe-qa-host: ${qaSocket}`);
	Effect.runFork(
		keepQaHost({
			signed: qaConfig.build.mac.codesign,
			path: qaSocket,
			title: launched.opened.title,
			url: launched.opened.url,
			sender: {
				executeJavascript: launched.executeJavascript,
			},
			message: qaInternalMessageMap(electrobunNative.internalRpcHandlers.message),
		}).pipe(Effect.scoped)
	);
}

setTimeout(() => {
	launched.executeJavascript(acepeShellPingScript(RPC_ROUNDTRIP_MESSAGE));
}, 2000);

setTimeout(() => {
	if (sawRpcRoundtrip === false) {
		writeLine(`${SHELL_STARTUP_FAILED_PREFIX}: no rpc round trip from the window`);
		process.exit(1);
	}
}, RPC_ROUNDTRIP_WAIT_MS);
