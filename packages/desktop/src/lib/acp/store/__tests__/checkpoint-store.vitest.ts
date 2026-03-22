
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../../errors/app-error.js";

import { CheckpointError } from "../../errors/checkpoint-error.js";
import type { Checkpoint, RevertResult } from "../../types/checkpoint.js";

// Mock the tauri-client module
vi.mock("../../../utils/tauri-client.js", () => ({
	tauriClient: {
		checkpoint: {
			create: vi.fn(),
			list: vi.fn(),
			getFileContent: vi.fn(),
			getFileDiffContent: vi.fn(),
			revert: vi.fn(),
			revertFile: vi.fn(),
			getFileSnapshots: vi.fn(),
		},
	},
}));

import { tauriClient } from "../../../utils/tauri-client.js";
import { CheckpointStore } from "../checkpoint-store.svelte.js";

describe("CheckpointStore", () => {
	let store: CheckpointStore;

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Create fresh store for each test
		store = new CheckpointStore();
	});

	describe("loadCheckpoints", () => {
		it("should load checkpoints for a session", async () => {
			const mockCheckpoints: Checkpoint[] = [
				{
					id: "cp1",
					sessionId: "s1",
					checkpointNumber: 2,
					name: "After edit",
					createdAt: Date.now(),
					toolCallId: "tc1",
					isAuto: true,
					fileCount: 2,
					totalLinesAdded: 10,
					totalLinesRemoved: 5,
				},
				{
					id: "cp0",
					sessionId: "s1",
					checkpointNumber: 1,
					name: null,
					createdAt: Date.now() - 1000,
					toolCallId: null,
					isAuto: true,
					fileCount: 1,
					totalLinesAdded: null,
					totalLinesRemoved: null,
				},
			];
			vi.mocked(tauriClient.checkpoint.list).mockReturnValue(okAsync(mockCheckpoints));

			const result = await store.loadCheckpoints("s1");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual(mockCheckpoints);
			expect(store.getCheckpoints("s1")).toEqual(mockCheckpoints);
		});

		it("should return error on failure", async () => {
			const error = new CheckpointError("DB error", "STORAGE_ERROR");
			vi.mocked(tauriClient.checkpoint.list).mockReturnValue(errAsync(error as any));

			const result = await store.loadCheckpoints("s1");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().code).toBe("STORAGE_ERROR");
		});
	});

	describe("createCheckpoint", () => {
		it("should create checkpoint and update local state", async () => {
			const mockCheckpoint: Checkpoint = {
				id: "cp1",
				sessionId: "s1",
				checkpointNumber: 1,
				name: "Manual checkpoint",
				createdAt: Date.now(),
				toolCallId: null,
				isAuto: false,
				fileCount: 3,
				totalLinesAdded: 15,
				totalLinesRemoved: 3,
			};
			vi.mocked(tauriClient.checkpoint.create).mockReturnValue(okAsync(mockCheckpoint));

			const result = await store.createCheckpoint(
				"s1",
				"/project",
				["file1.ts", "file2.ts", "file3.ts"],
				{ name: "Manual checkpoint", isAuto: false }
			);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual(mockCheckpoint);
			// New checkpoint should be at the front of the list
			expect(store.getCheckpoints("s1")[0]).toEqual(mockCheckpoint);
		});

		it("should prepend new checkpoint to existing list", async () => {
			// Setup existing checkpoints
			const existingCheckpoint: Checkpoint = {
				id: "cp0",
				sessionId: "s1",
				checkpointNumber: 1,
				name: null,
				createdAt: Date.now() - 1000,
				toolCallId: null,
				isAuto: true,
				fileCount: 1,
				totalLinesAdded: null,
				totalLinesRemoved: null,
			};
			vi.mocked(tauriClient.checkpoint.list).mockReturnValue(okAsync([existingCheckpoint]));
			await store.loadCheckpoints("s1");

			// Create new checkpoint
			const newCheckpoint: Checkpoint = {
				id: "cp1",
				sessionId: "s1",
				checkpointNumber: 2,
				name: null,
				createdAt: Date.now(),
				toolCallId: "tc1",
				isAuto: true,
				fileCount: 2,
				totalLinesAdded: 8,
				totalLinesRemoved: 2,
			};
			vi.mocked(tauriClient.checkpoint.create).mockReturnValue(okAsync(newCheckpoint));

			await store.createCheckpoint("s1", "/project", ["file.ts"], { toolCallId: "tc1" });

			const checkpoints = store.getCheckpoints("s1");
			expect(checkpoints).toHaveLength(2);
			expect(checkpoints[0]).toEqual(newCheckpoint);
			expect(checkpoints[1]).toEqual(existingCheckpoint);
		});

		it("should include root cause details in create checkpoint error message", async () => {
			const rootCause = new Error("FOREIGN KEY constraint failed");
			const tauriError = new AgentError("checkpoint_create", rootCause);
			vi.mocked(tauriClient.checkpoint.create).mockReturnValue(errAsync(tauriError));

			const result = await store.createCheckpoint("s1", "/project", ["file.ts"], { isAuto: true });

			expect(result.isErr()).toBe(true);
			const error = result._unsafeUnwrapErr();
			expect(error.code).toBe("CREATE_FAILED");
			expect(error.message).toContain("Agent operation failed: checkpoint_create");
			expect(error.message).toContain("FOREIGN KEY constraint failed");
		});
	});

	describe("revertToCheckpoint", () => {
		it("should revert all files in checkpoint", async () => {
			const mockResult: RevertResult = {
				success: true,
				revertedFiles: ["a.ts", "b.ts"],
				failedFiles: [],
			};
			vi.mocked(tauriClient.checkpoint.revert).mockReturnValue(okAsync(mockResult));

			const result = await store.revertToCheckpoint("s1", "cp1", "/project");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap().revertedFiles).toHaveLength(2);
		});

		it("should return partial result when some files fail", async () => {
			const mockResult: RevertResult = {
				success: false,
				revertedFiles: ["a.ts"],
				failedFiles: [{ filePath: "b.ts", error: "permission denied" }],
			};
			vi.mocked(tauriClient.checkpoint.revert).mockReturnValue(okAsync(mockResult));

			const result = await store.revertToCheckpoint("s1", "cp1", "/project");

			expect(result.isOk()).toBe(true);
			const revertResult = result._unsafeUnwrap();
			expect(revertResult.success).toBe(false);
			expect(revertResult.revertedFiles).toHaveLength(1);
			expect(revertResult.failedFiles).toHaveLength(1);
		});
	});

	describe("revertFile", () => {
		it("should revert single file to checkpoint state", async () => {
			vi.mocked(tauriClient.checkpoint.revertFile).mockReturnValue(okAsync(undefined));

			const result = await store.revertFile("s1", "cp1", "file.ts", "/project");

			expect(result.isOk()).toBe(true);
		});
	});

	describe("getFileContentAtCheckpoint", () => {
		it("should return file content", async () => {
			const content = "const x = 1;";
			vi.mocked(tauriClient.checkpoint.getFileContent).mockReturnValue(okAsync(content));

			const result = await store.getFileContentAtCheckpoint("s1", "cp1", "file.ts");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(content);
		});
	});

	describe("getFileDiffContentAtCheckpoint", () => {
		it("should return old and new content", async () => {
			const diffContent = {
				oldContent: "const x = 0;",
				newContent: "const x = 1;",
			};
			vi.mocked(tauriClient.checkpoint.getFileDiffContent).mockReturnValue(okAsync(diffContent));

			const result = await store.getFileDiffContentAtCheckpoint("s1", "cp1", "file.ts");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual(diffContent);
		});

		it("should return null oldContent for new file", async () => {
			const diffContent = {
				oldContent: null,
				newContent: "const x = 1;",
			};
			vi.mocked(tauriClient.checkpoint.getFileDiffContent).mockReturnValue(okAsync(diffContent));

			const result = await store.getFileDiffContentAtCheckpoint("s1", "cp1", "file.ts");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual(diffContent);
		});
	});

	describe("getCheckpoints", () => {
		it("should return empty array for unknown session", () => {
			expect(store.getCheckpoints("unknown")).toEqual([]);
		});
	});

	describe("clearCheckpoints", () => {
		it("should clear checkpoints for a session", async () => {
			// Setup existing checkpoints
			const checkpoint: Checkpoint = {
				id: "cp0",
				sessionId: "s1",
				checkpointNumber: 1,
				name: null,
				createdAt: Date.now(),
				toolCallId: null,
				isAuto: true,
				fileCount: 1,
				totalLinesAdded: null,
				totalLinesRemoved: null,
			};
			vi.mocked(tauriClient.checkpoint.list).mockReturnValue(okAsync([checkpoint]));
			await store.loadCheckpoints("s1");
			expect(store.getCheckpoints("s1")).toHaveLength(1);

			// Clear
			store.clearCheckpoints("s1");

			expect(store.getCheckpoints("s1")).toEqual([]);
		});
	});
});
