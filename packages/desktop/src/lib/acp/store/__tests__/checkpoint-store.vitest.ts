import {
	CheckpointId,
	type RpcClient,
	type RpcProjectedCheckpoint,
	type RpcSessionSnapshot,
	RpcTransportError,
	SessionId,
	ToolCallId
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckpointError } from "../../errors/checkpoint-error.js";
import { setAppRpcClientForTest } from "../../../rpc/app-client.js";
import { CheckpointStore } from "../checkpoint-store.svelte.js";

const CREATED_AT = "2026-01-15T12:00:00.000Z";
const CREATED_AT_MS = Date.parse(CREATED_AT);

const unusedIndex = () =>
	Effect.fail(new RpcTransportError({ reason: "project index unused in checkpoint tests" }));

const rpcFile = (path: string, content: string, linesAdded: number, linesRemoved: number) => ({
	path,
	contentHash: `hash-${path}`,
	fileSize: content.length,
	linesAdded,
	linesRemoved,
	content
});

const rpcCheckpoint = (input: {
	readonly checkpointId: string;
	readonly sessionId: string;
	readonly checkpointNumber: number;
	readonly name: string | null;
	readonly isAuto: boolean;
	readonly toolCallId: string | null;
	readonly files: RpcProjectedCheckpoint["files"];
}): RpcProjectedCheckpoint => ({
	checkpointId: CheckpointId.make(input.checkpointId),
	sessionId: SessionId.make(input.sessionId),
	sequence: 1,
	checkpointNumber: input.checkpointNumber,
	name: input.name,
	isAuto: input.isAuto,
	toolCallId: input.toolCallId === null ? null : ToolCallId.make(input.toolCallId),
	fileCount: input.files.length,
	status: "ready",
	createdAt: CREATED_AT,
	lastRevertedAt: null,
	files: input.files
});

const rpcSnapshot = (checkpoints: ReadonlyArray<RpcProjectedCheckpoint>): RpcSessionSnapshot => ({
	snapshotSequence: 1,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	checkpoints,
	projects: [],
	sessions: [],
	settings: [],
	skillsCatalog: null,
	voice: null,
	gitReview: null,
	mcpCatalog: null,
	preconnectionOptions: null
});

const installClient = (input: {
	readonly snapshot: RpcSessionSnapshot;
	readonly dispatch?: RpcClient["dispatch"];
}): { readonly dispatched: Array<string> } => {
	const dispatched: Array<string> = [];
	let snapshot = input.snapshot;
	setAppRpcClientForTest({
		dispatch: (command) => {
			dispatched.push(command.type);
			if (input.dispatch !== undefined) {
				return input.dispatch(command);
			}
			if (command.type === "checkpoint.create") {
				snapshot = rpcSnapshot([
					rpcCheckpoint({
						checkpointId: command.checkpointId,
						sessionId: command.sessionId,
						checkpointNumber: command.checkpointNumber,
						name: command.name,
						isAuto: command.isAuto,
						toolCallId: command.toolCallId,
						files: command.modifiedFiles.map((path) => rpcFile(path, "const x = 1;", 1, 0))
					}),
					...snapshot.checkpoints
				]);
			}
			return Effect.succeed({ sequence: 1 });
		},
		snapshot: () => Effect.succeed(snapshot),
		events: () => Stream.empty,
		getProjectIndex: unusedIndex,
		invalidateProjectIndex: () => Effect.void
	});
	return { dispatched };
};

describe("CheckpointStore", () => {
	let store: CheckpointStore;

	beforeEach(() => {
		store = new CheckpointStore();
	});

	afterEach(() => {
		setAppRpcClientForTest(null);
	});

	describe("loadCheckpoints", () => {
		it("should load checkpoints for a session", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp1",
						sessionId: "s1",
						checkpointNumber: 2,
						name: "After edit",
						isAuto: true,
						toolCallId: "tc1",
						files: [
							rpcFile("a.ts", "a", 10, 5),
							rpcFile("b.ts", "b", 0, 0)
						]
					}),
					rpcCheckpoint({
						checkpointId: "cp0",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("a.ts", "old", 1, 0)]
					})
				])
			});

			const result = await Effect.runPromise(Effect.result(store.loadCheckpoints("s1")));

			expect(Result.isSuccess(result)).toBe(true);
			const loaded = Result.getOrThrow(result);
			expect(loaded.map((row) => row.id)).toEqual(["cp1", "cp0"]);
			expect(loaded[0]?.createdAt).toBe(CREATED_AT_MS);
			expect(loaded[0]?.totalLinesAdded).toBe(10);
			expect(loaded[0]?.totalLinesRemoved).toBe(5);
			expect(store.getCheckpoints("s1").map((row) => row.id)).toEqual(["cp1", "cp0"]);
		});

		it("should return error on failure", async () => {
			installClient({
				snapshot: rpcSnapshot([]),
				dispatch: () => Effect.succeed({ sequence: 1 })
			});
			setAppRpcClientForTest({
				dispatch: () => Effect.succeed({ sequence: 1 }),
				snapshot: () => Effect.fail(new RpcTransportError({ reason: "DB error" })),
				events: () => Stream.empty,
				getProjectIndex: unusedIndex,
				invalidateProjectIndex: () => Effect.void
			});

			const result = await Effect.runPromise(Effect.result(store.loadCheckpoints("s1")));

			expect(Result.isFailure(result)).toBe(true);
			expect(Result.isFailure(result) ? result.failure.code : undefined).toBe("STORAGE_ERROR");
		});
	});

	describe("createCheckpoint", () => {
		it("should create checkpoint and update local state", async () => {
			const { dispatched } = installClient({ snapshot: rpcSnapshot([]) });

			const result = await Effect.runPromise(
				Effect.result(
					store.createCheckpoint("s1", "/project", ["file1.ts", "file2.ts", "file3.ts"], {
						name: "Manual checkpoint",
						isAuto: false
					})
				)
			);

			expect(Result.isSuccess(result)).toBe(true);
			const created = Result.getOrThrow(result);
			expect(created.name).toBe("Manual checkpoint");
			expect(created.fileCount).toBe(3);
			expect(store.getCheckpoints("s1")[0]?.id).toBe(created.id);
			expect(dispatched).toEqual(["checkpoint.create", "checkpoint.report-readiness"]);
		});

		it("should prepend new checkpoint to existing list", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp0",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("old.ts", "old", 1, 0)]
					})
				])
			});
			await Effect.runPromise(store.loadCheckpoints("s1"));

			await Effect.runPromise(
				store.createCheckpoint("s1", "/project", ["file.ts"], { toolCallId: "tc1" })
			);

			const checkpoints = store.getCheckpoints("s1");
			expect(checkpoints).toHaveLength(2);
			expect(checkpoints[0]?.toolCallId).toBe("tc1");
			expect(checkpoints[1]?.id).toBe("cp0");
		});

		it("should include root cause details in create checkpoint error message", async () => {
			installClient({
				snapshot: rpcSnapshot([]),
				dispatch: () =>
					Effect.fail(new RpcTransportError({ reason: "FOREIGN KEY constraint failed" }))
			});

			const result = await Effect.runPromise(
				Effect.result(store.createCheckpoint("s1", "/project", ["file.ts"], { isAuto: true }))
			);

			expect(Result.isFailure(result)).toBe(true);
			if (!Result.isFailure(result)) {
				throw new Error("expected failure");
			}
			const error = result.failure;
			expect(error.code).toBe("CREATE_FAILED");
			expect(error.message).toContain("Failed to create checkpoint");
			expect(error.message).toContain("FOREIGN KEY constraint failed");
		});
	});

	describe("revertToCheckpoint", () => {
		it("should revert all files in checkpoint", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp1",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("a.ts", "a", 1, 0), rpcFile("b.ts", "b", 1, 0)]
					})
				])
			});
			await Effect.runPromise(store.loadCheckpoints("s1"));

			const result = await Effect.runPromise(
				Effect.result(store.revertToCheckpoint("s1", "cp1", "/project"))
			);

			expect(Result.isSuccess(result)).toBe(true);
			expect(Result.getOrThrow(result).revertedFiles).toHaveLength(2);
		});
	});

	describe("revertFile", () => {
		it("should revert single file to checkpoint state", async () => {
			installClient({ snapshot: rpcSnapshot([]) });

			const result = await Effect.runPromise(
				Effect.result(store.revertFile("s1", "cp1", "file.ts", "/project"))
			);

			expect(Result.isSuccess(result)).toBe(true);
		});
	});

	describe("getFileContentAtCheckpoint", () => {
		it("should return file content", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp1",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("file.ts", "const x = 1;", 1, 0)]
					})
				])
			});
			await Effect.runPromise(store.loadCheckpoints("s1"));

			const result = await Effect.runPromise(
				Effect.result(store.getFileContentAtCheckpoint("s1", "cp1", "file.ts"))
			);

			expect(Result.isSuccess(result)).toBe(true);
			expect(Result.getOrThrow(result)).toBe("const x = 1;");
		});
	});

	describe("getFileDiffContentAtCheckpoint", () => {
		it("should return old and new content", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp1",
						sessionId: "s1",
						checkpointNumber: 2,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("file.ts", "const x = 1;", 1, 0)]
					}),
					rpcCheckpoint({
						checkpointId: "cp0",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("file.ts", "const x = 0;", 1, 0)]
					})
				])
			});
			await Effect.runPromise(store.loadCheckpoints("s1"));

			const result = await Effect.runPromise(
				Effect.result(store.getFileDiffContentAtCheckpoint("s1", "cp1", "file.ts"))
			);

			expect(Result.isSuccess(result)).toBe(true);
			expect(Result.getOrThrow(result)).toEqual({
				oldContent: "const x = 0;",
				newContent: "const x = 1;"
			});
		});

		it("should return null oldContent for new file", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp1",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("file.ts", "const x = 1;", 1, 0)]
					})
				])
			});
			await Effect.runPromise(store.loadCheckpoints("s1"));

			const result = await Effect.runPromise(
				Effect.result(store.getFileDiffContentAtCheckpoint("s1", "cp1", "file.ts"))
			);

			expect(Result.isSuccess(result)).toBe(true);
			expect(Result.getOrThrow(result)).toEqual({
				oldContent: null,
				newContent: "const x = 1;"
			});
		});
	});

	describe("getCheckpoints", () => {
		it("should return empty array for unknown session", () => {
			expect(store.getCheckpoints("unknown")).toEqual([]);
		});
	});

	describe("clearCheckpoints", () => {
		it("should clear checkpoints for a session", async () => {
			installClient({
				snapshot: rpcSnapshot([
					rpcCheckpoint({
						checkpointId: "cp0",
						sessionId: "s1",
						checkpointNumber: 1,
						name: null,
						isAuto: true,
						toolCallId: null,
						files: [rpcFile("a.ts", "a", 1, 0)]
					})
				])
			});
			await Effect.runPromise(store.loadCheckpoints("s1"));
			expect(store.getCheckpoints("s1")).toHaveLength(1);

			store.clearCheckpoints("s1");

			expect(store.getCheckpoints("s1")).toEqual([]);
		});
	});
});
