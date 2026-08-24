import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import {
	acepeShellPingScript,
	applyNativeWrapperCwdOrExit,
	joinPathSegments,
	qaSurfaceEnabled,
	RPC_ROUNDTRIP_MESSAGE,
	RPC_ROUNDTRIP_PREFIX,
	resolveElectrobunConfig,
	SHELL_PROOF_LOG_PATH,
	SHELL_STARTUP_FAILED_PREFIX,
	startElectrobunAcepeApp,
} from "@acepe/electrobun-shell";
import { makeAcepeLive } from "@acepe/server/bootstrap";
import { seedGitReview } from "@acepe/server/library/seedGitReview";
import { seedLibrary } from "@acepe/server/library/seedLibrary";
import { SKILLS_MCP_SEED_HOME, seedSkillsMcp } from "@acepe/server/library/seedSkillsMcp";
import {
	encodedDispatch,
	encodedGetDefaultShell,
	encodedGetProjectIndex,
	encodedGetProviderAccountUsage,
	encodedGitCall,
	encodedImportProviderSession,
	encodedInvalidateProjectIndex,
	encodedListProviderProjects,
	encodedListProviderSessions,
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

// One instance key scopes the QA socket, the seed fixtures and this DB, so
// parallel app instances never share state.
const loadTracerDbFilename = Effect.fn("loadTracerDbFilename")(function* () {
	const instance = yield* Config.string("APP_ID").pipe(
		Config.nested("ELECTROBUN_QA"),
		Config.withDefault("")
	);
	if (instance === "") {
		return "acepe-tracer.sqlite";
	}
	return `acepe-tracer-${instance.replace(/[^a-zA-Z0-9.-]/g, "-")}.sqlite`;
});

import { keepQaHost, qaInternalMessageMap, qaWindowPreload } from "./qa-host.ts";

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

const qaConfig = resolveElectrobunConfig();
const qaEnabled = qaSurfaceEnabled(qaConfig);

const runtime = ManagedRuntime.make(
	makeAcepeLive({
		filename: Effect.runSync(loadTracerDbFilename()),
		tokenDelay: Duration.millis(40),
		skillsHomeDir: SKILLS_MCP_SEED_HOME,
		voiceQaSurfaceEnabled: qaEnabled,
	})
);

await runtime.runPromise(seedLibrary());
await runtime.runPromise(seedGitReview());
await runtime.runPromise(seedSkillsMcp());

let sawRpcRoundtrip = false;

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
	{ preload: qaWindowPreload(qaEnabled, qaPreloadScript) }
);

launched.attach({
	dispatch: (params) => runtime.runPromise(encodedDispatch(params)),
	snapshot: (params) => runtime.runPromise(encodedSnapshot(params)),
	getProjectIndex: (params) => runtime.runPromise(encodedGetProjectIndex(params)),
	invalidateProjectIndex: (params) => runtime.runPromise(encodedInvalidateProjectIndex(params)),
	readTextFile: (params) => runtime.runPromise(encodedReadTextFile(params)),
	writeTextFile: (params) => runtime.runPromise(encodedWriteTextFile(params)),
	getDefaultShell: (params) => runtime.runPromise(encodedGetDefaultShell(params)),
	gitCall: (params) => runtime.runPromise(encodedGitCall(params)),
	getProviderAccountUsage: (params) => runtime.runPromise(encodedGetProviderAccountUsage(params)),
	listProviderSessions: (params) => runtime.runPromise(encodedListProviderSessions(params)),
	listProviderProjects: (params) => runtime.runPromise(encodedListProviderProjects(params)),
	importProviderSession: (params) => runtime.runPromise(encodedImportProviderSession(params)),
	events: (params) => {
		writeLine(`acepe-events-stream: requested ${JSON.stringify(params).slice(0, 80)}`);
		runtime.runFork(
			pushEvents(params, (payload) => {
				writeLine("acepe-events-stream: push");
				launched.sendEvents(payload);
			})
		);
		return undefined;
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
