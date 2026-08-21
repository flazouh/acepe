import { expect, test } from "bun:test";
import {
	DEFAULT_LIVE_APP_PATH,
	liveLauncherCwd,
	liveLauncherPath,
	logHasRpcRoundtrip,
	proveLiveWindow,
} from "./prove-live-window.ts";

test("live launcher paths point at Contents/MacOS", () => {
	expect(liveLauncherPath(DEFAULT_LIVE_APP_PATH)).toBe("/tmp/Acepe.app/Contents/MacOS/launcher");
	expect(liveLauncherCwd(DEFAULT_LIVE_APP_PATH)).toBe("/tmp/Acepe.app/Contents/MacOS");
});

test("proveLiveWindow asserts the ping echo from the window", () => {
	const proof = proveLiveWindow({
		logText: "acepe-shell-rpc-roundtrip: desktop round trip\n",
		processListStdout: "Acepe, Terminal",
	});
	expect(proof.passed).toBe(true);
	expect(proof.echo).toBe("desktop round trip");
	expect(proof.expectedEcho).toBe("desktop round trip");
	expect(proof.acepeVisible).toBe(true);
});

test("logHasRpcRoundtrip finds the echoed desktop round trip line", () => {
	expect(logHasRpcRoundtrip("acepe-shell-rpc-roundtrip: desktop round trip\n")).toBe(true);
	expect(logHasRpcRoundtrip("[LAUNCHER] Loading app code from flat files\n")).toBe(false);
});
