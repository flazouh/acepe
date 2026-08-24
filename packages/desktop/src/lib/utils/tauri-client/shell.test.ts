import { afterEach, describe, expect, it } from "bun:test";
import { emptyRpcSessionSnapshot, type RpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { shell } from "./shell.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("shell tauri client", () => {
	it("reads the default shell through the contract", async () => {
		setAppRpcClientForTest(makeClient({ getDefaultShell: () => Effect.succeed("/bin/fish") }));

		const result = await Effect.runPromise(Effect.result(shell.getDefaultShell()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(Result.getOrThrow(result)).toBe("/bin/fish");
	});

	it("fails openInFinder as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(shell.openInFinder("session-1", "/tmp/acepe"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails openStreamingLog as unsupported on the contract", async () => {
		const result = await Effect.runPromise(Effect.result(shell.openStreamingLog("session-1")));
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails getStreamingLogPath as unsupported on the contract", async () => {
		const result = await Effect.runPromise(Effect.result(shell.getStreamingLogPath("session-1")));
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails getSessionFilePath as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(shell.getSessionFilePath("session-1", "/tmp/acepe"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});
});
