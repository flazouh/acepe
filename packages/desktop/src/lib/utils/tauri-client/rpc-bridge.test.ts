import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type RpcClient,
	RpcTransportError,
	settingsSnapshotRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { AgentError } from "../../acp/errors/app-error.js";
import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import {
	decodeTrimmed,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";

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
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("rpc-bridge", () => {
	it("mints distinct command ids", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* nextCommandId("settings-set");
				const second = yield* nextCommandId("settings-set");
				expect(first).not.toBe(second);
			})
		));

	it("maps rpc failures onto AgentError", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.fail(new RpcTransportError({ reason: "bridge down" })),
					})
				);
				const result = yield* Effect.result(
					withRpcClient("settings.snapshot", (client) =>
						client.snapshot(settingsSnapshotRequest())
					)
				);
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure).toBeInstanceOf(AgentError);
					expect(result.failure.operation).toBe("settings.snapshot");
				}
			})
		));

	it("rejects blank trimmed strings", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const result = yield* Effect.result(decodeTrimmed("projects.import", "   "));
				expect(Result.isFailure(result)).toBe(true);
			})
		));

	it("fails unsupported contract operations", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const result = yield* Effect.result(unsupportedOnContract("skills.create"));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure.operation).toBe("skills.create");
				}
			})
		));
});
