import { afterEach, describe, expect, it } from "bun:test";
import { emptyRpcSessionSnapshot, type RpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { fs } from "./fs.ts";

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
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("fs tauri client", () => {
	it("reads a text file with no pagination", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient({
				readTextFile: (request) => {
					requested = request;
					return Effect.succeed("file content");
				},
			})
		);

		const result = await Effect.runPromise(Effect.result(fs.readTextFile("/tmp/acepe/a.ts")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(Result.getOrThrow(result)).toBe("file content");
		expect(requested).toEqual({ path: "/tmp/acepe/a.ts" });
	});

	it("reads a text file with line and limit pagination", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient({
				readTextFile: (request) => {
					requested = request;
					return Effect.succeed("line two");
				},
			})
		);

		const result = await Effect.runPromise(Effect.result(fs.readTextFile("/tmp/acepe/a.ts", 2, 1)));

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({ path: "/tmp/acepe/a.ts", line: 2, limit: 1 });
	});

	it("writes a text file, decoding the sessionId onto the contract", async () => {
		let requested: unknown = null;
		setAppRpcClientForTest(
			makeClient({
				writeTextFile: (request) => {
					requested = request;
					return Effect.void;
				},
			})
		);

		const result = await Effect.runPromise(
			Effect.result(fs.writeTextFile("/tmp/acepe/a.ts", "hello", "session-1"))
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(requested).toEqual({
			path: "/tmp/acepe/a.ts",
			content: "hello",
			sessionId: "session-1",
		});
	});

	it("fails with an AgentError when the sessionId is blank", async () => {
		setAppRpcClientForTest(makeClient({}));

		const result = await Effect.runPromise(
			Effect.result(fs.writeTextFile("/tmp/acepe/a.ts", "hello", "   "))
		);

		expect(Result.isFailure(result)).toBe(true);
	});
});
