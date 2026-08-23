import { afterEach, describe, expect, it } from "bun:test";
import {
	CheckpointId,
	emptyRpcSessionSnapshot,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { checkpoint } from "./checkpoint.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const sessionId = SessionId.make("session-1");
const checkpointId = CheckpointId.make("checkpoint-1");

const projected = {
	checkpointId,
	sessionId,
	sequence: 1,
	checkpointNumber: 1,
	name: null,
	isAuto: true,
	toolCallId: null,
	fileCount: 2,
	status: "ready" as const,
	createdAt: "2026-08-23T09:00:00.000Z",
	lastRevertedAt: null,
};

const withCheckpoints = (
	snapshot: RpcSessionSnapshot,
	rows: RpcSessionSnapshot["checkpoints"]
): RpcSessionSnapshot => ({
	...snapshot,
	checkpoints: rows,
});

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(withCheckpoints(emptyRpcSessionSnapshot(0), [projected])),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("checkpoint rpc facade", () => {
	it("lists checkpoints from the session snapshot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const listed = yield* checkpoint.list("session-1");
				const createdAt = DateTime.make("2026-08-23T09:00:00.000Z");
				expect(Option.isSome(createdAt)).toBe(true);
				if (Option.isNone(createdAt)) {
					return;
				}
				expect(listed).toEqual([
					{
						id: "checkpoint-1",
						sessionId: "session-1",
						checkpointNumber: 1,
						name: null,
						createdAt: DateTime.toEpochMillis(createdAt.value),
						toolCallId: null,
						isAuto: true,
						fileCount: 2,
						totalLinesAdded: null,
						totalLinesRemoved: null,
					},
				]);
			})
		));

	it("creates a checkpoint then reports readiness", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				let createdId = checkpointId;
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							if (command.type === "checkpoint.create") {
								createdId = command.checkpointId;
							}
							return Effect.succeed({ sequence: 1 });
						},
						snapshot: () =>
							Effect.succeed(
								withCheckpoints(emptyRpcSessionSnapshot(0), [
									{
										checkpointId: createdId,
										sessionId,
										sequence: 1,
										checkpointNumber: 1,
										name: null,
										isAuto: true,
										toolCallId: null,
										fileCount: 2,
										status: "ready",
										createdAt: "2026-08-23T09:00:00.000Z",
										lastRevertedAt: null,
									},
								])
							),
					})
				);
				const created = yield* checkpoint.create("session-1", "/repo", ["a.ts", "b.ts"], {
					isAuto: true,
				});
				expect(dispatched).toEqual(["checkpoint.create", "checkpoint.report-readiness"]);
				expect(created.id).toBe(String(createdId));
				expect(created.fileCount).toBe(2);
			})
		));

	it("reverts through checkpoint.revert", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const reverted = yield* checkpoint.revert("session-1", "checkpoint-1", "/repo");
				expect(dispatched).toEqual(["checkpoint.revert"]);
				expect(reverted.success).toBe(true);
				expect(reverted.revertedFiles).toEqual([]);
			})
		));

	it("fails file content reads that are not on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(
					checkpoint.getFileContent("session-1", "checkpoint-1", "a.ts")
				);
				expect(Result.isFailure(result)).toBe(true);
			})
		));
});
