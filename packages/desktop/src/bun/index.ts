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
import { seedLibrary } from "@acepe/server/library/seedLibrary";
import { seedGitReview } from "@acepe/server/library/seedGitReview";
import {
	encodedDispatch,
	encodedGetProjectIndex,
	encodedInvalidateProjectIndex,
	encodedSnapshot,
	pushEvents,
} from "@acepe/server/rpc/encodedBoundary";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { loadQaSocketPath, qaPreloadScript } from "electrobun-qa";
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

const runtime = ManagedRuntime.make(
	makeAcepeLive({
		filename: "acepe-tracer.sqlite",
		tokenDelay: Duration.millis(40),
	})
);

await runtime.runPromise(seedLibrary());
await runtime.runPromise(seedGitReview());

let sawRpcRoundtrip = false;

const qaConfig = resolveElectrobunConfig();
const qaEnabled = qaSurfaceEnabled(qaConfig);

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
	events: (params) => {
		runtime.runFork(
			pushEvents(params, (payload) => {
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
