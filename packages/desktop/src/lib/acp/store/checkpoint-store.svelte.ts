/**
 * Checkpoint store for file versioning and revert.
 *
 * Reads checkpoints from the session snapshot and writes create/revert
 * through dispatch. File bytes come from RpcProjectedCheckpoint.files.
 */

import {
	CheckpointCreateCommand,
	CheckpointId,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
	CheckpointRevertFileCommand,
	CommandId,
	ToolCallId,
	type RpcCheckpointFile,
	type RpcProjectedCheckpoint,
	type RpcSessionSnapshot,
	SessionId,
	sessionSnapshotRequest
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { SvelteMap } from "svelte/reactivity";
import type { FileDiffContent } from "../../services/checkpoint-types.js";
import { appRpcClient } from "../../rpc/app-client.js";
import { CheckpointError, type CheckpointErrorCode } from "../errors/checkpoint-error.js";
import { formatErrorWithCauses } from "../errors/error-cause-details.js";
import type { Checkpoint, FileSnapshot, RevertResult } from "../types/checkpoint.js";

const asCheckpointError = (message: string, code: CheckpointErrorCode, cause: unknown) =>
	new CheckpointError(message, code, cause);

const toFileSnapshot = (checkpointId: string, file: RpcCheckpointFile): FileSnapshot => ({
	id: `${checkpointId}:${file.path}`,
	checkpointId,
	filePath: file.path,
	contentHash: file.contentHash,
	fileSize: file.fileSize,
	linesAdded: file.linesAdded,
	linesRemoved: file.linesRemoved,
	content: file.content
});

const sumLines = (files: ReadonlyArray<RpcCheckpointFile>, key: "linesAdded" | "linesRemoved") => {
	let total: number | null = null;
	for (const file of files) {
		const value = file[key];
		if (value === null) {
			continue;
		}
		total = (total ?? 0) + value;
	}
	return total;
};

const toCheckpoint = (row: RpcProjectedCheckpoint): Checkpoint => ({
	id: row.checkpointId,
	sessionId: row.sessionId,
	checkpointNumber: row.checkpointNumber,
	name: row.name,
	createdAt: Date.parse(row.createdAt),
	toolCallId: row.toolCallId,
	isAuto: row.isAuto,
	fileCount: row.fileCount,
	totalLinesAdded: sumLines(row.files, "linesAdded"),
	totalLinesRemoved: sumLines(row.files, "linesRemoved"),
	files: row.files.map((file) => toFileSnapshot(row.checkpointId, file))
});

const sortNewestFirst = (rows: ReadonlyArray<Checkpoint>): Checkpoint[] =>
	rows.slice().sort((left, right) => right.checkpointNumber - left.checkpointNumber);

const snapshotCheckpoints = (snapshot: RpcSessionSnapshot, sessionId: string): Checkpoint[] =>
	sortNewestFirst(
		snapshot.checkpoints
			.filter((row) => row.sessionId === sessionId)
			.map(toCheckpoint)
	);

const findCheckpoint = (
	rows: ReadonlyArray<Checkpoint>,
	checkpointId: string
): Checkpoint | undefined => rows.find((row) => row.id === checkpointId);

const findFile = (checkpoint: Checkpoint, filePath: string): FileSnapshot | undefined =>
	(checkpoint.files ?? []).find((file) => file.filePath === filePath);

const previousFileContent = (
	rows: ReadonlyArray<Checkpoint>,
	checkpoint: Checkpoint,
	filePath: string
): string | null => {
	const previous = rows
		.filter((row) => row.checkpointNumber < checkpoint.checkpointNumber)
		.sort((left, right) => right.checkpointNumber - left.checkpointNumber)[0];
	if (previous === undefined) {
		return null;
	}
	return findFile(previous, filePath)?.content ?? null;
};

/**
 * Store for checkpoint state and operations.
 */
export class CheckpointStore {
	/** Checkpoints indexed by session ID, newest first */
	private checkpointsBySession = new SvelteMap<string, Checkpoint[]>();

	/** Loading flag for the timeline */
	isLoading = $state(false);

	getCheckpoints(sessionId: string): Checkpoint[] {
		return this.checkpointsBySession.get(sessionId) ?? [];
	}

	loadCheckpoints(sessionId: string): Effect.Effect<Checkpoint[], CheckpointError> {
		this.isLoading = true;
		const store = this;
		return Effect.gen(function* () {
			const client = yield* appRpcClient();
			const snapshot = yield* client.snapshot(sessionSnapshotRequest(SessionId.make(sessionId)));
			const checkpoints = snapshotCheckpoints(snapshot, sessionId);
			store.checkpointsBySession.set(sessionId, checkpoints);
			store.isLoading = false;
			return checkpoints;
		}).pipe(
			Effect.mapError((error) =>
				asCheckpointError(`Failed to load checkpoints: ${formatErrorWithCauses(error instanceof Error ? error : new Error(String(error)))}`, "STORAGE_ERROR", error)
			),
			Effect.catch((error) => {
				this.isLoading = false;
				return Effect.fail(error);
			})
		);
	}

	createCheckpoint(
		sessionId: string,
		projectPath: string,
		modifiedFiles: string[],
		options?: {
			toolCallId?: string;
			name?: string;
			isAuto?: boolean;
			worktreePath?: string;
			agentId?: string;
		}
	): Effect.Effect<Checkpoint, CheckpointError> {
		const store = this;
		return Effect.gen(function* () {
			const client = yield* appRpcClient();
			const checkpointId = CheckpointId.make(crypto.randomUUID());
			const brandedSession = SessionId.make(sessionId);
			yield* client.dispatch(
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId: CommandId.make(crypto.randomUUID()),
					sessionId: brandedSession,
					checkpointId,
					checkpointNumber: 1,
					name: options?.name ?? null,
					isAuto: options?.isAuto ?? false,
					toolCallId:
						options?.toolCallId === undefined ? null : ToolCallId.make(options.toolCallId),
					fileCount: modifiedFiles.length,
					projectPath,
					worktreePath: options?.worktreePath ?? null,
					modifiedFiles
				})
			);
			yield* client.dispatch(
				CheckpointReportReadinessCommand.make({
					type: "checkpoint.report-readiness",
					commandId: CommandId.make(crypto.randomUUID()),
					sessionId: brandedSession,
					checkpointId,
					status: "ready"
				})
			);
			const checkpoints = yield* store.loadCheckpoints(sessionId);
			const created = findCheckpoint(checkpoints, checkpointId);
			if (created === undefined) {
				return yield* Effect.fail(
					new CheckpointError(
						`Failed to create checkpoint: missing from snapshot after dispatch`,
						"CREATE_FAILED"
					)
				);
			}
			return created;
		}).pipe(
			Effect.mapError((error) => {
				if (error instanceof CheckpointError) {
					return error;
				}
				return asCheckpointError(
					`Failed to create checkpoint: ${formatErrorWithCauses(error instanceof Error ? error : new Error(String(error)))}`,
					"CREATE_FAILED",
					error
				);
			})
		);
	}

	revertToCheckpoint(
		sessionId: string,
		checkpointId: string,
		projectPath: string
	): Effect.Effect<RevertResult, CheckpointError> {
		const store = this;
		return Effect.gen(function* () {
			const client = yield* appRpcClient();
			const before = findCheckpoint(store.getCheckpoints(sessionId), checkpointId);
			yield* client.dispatch(
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId: CommandId.make(crypto.randomUUID()),
					sessionId: SessionId.make(sessionId),
					checkpointId: CheckpointId.make(checkpointId),
					projectPath,
					worktreePath: null
				})
			);
			yield* store.loadCheckpoints(sessionId);
			const revertedFiles = before?.files?.map((file) => file.filePath) ?? [];
			return {
				success: true,
				revertedFiles,
				failedFiles: []
			};
		}).pipe(
			Effect.mapError((error) =>
				asCheckpointError(
					`Failed to revert: ${formatErrorWithCauses(error instanceof Error ? error : new Error(String(error)))}`,
					"REVERT_FAILED",
					error
				)
			)
		);
	}

	revertFile(
		sessionId: string,
		checkpointId: string,
		filePath: string,
		projectPath: string
	): Effect.Effect<void, CheckpointError> {
		return Effect.gen(function* () {
			const client = yield* appRpcClient();
			yield* client.dispatch(
				CheckpointRevertFileCommand.make({
					type: "checkpoint.revert-file",
					commandId: CommandId.make(crypto.randomUUID()),
					sessionId: SessionId.make(sessionId),
					checkpointId: CheckpointId.make(checkpointId),
					filePath,
					projectPath,
					worktreePath: null
				})
			);
		}).pipe(
			Effect.mapError((error) =>
				asCheckpointError(
					`Failed to revert file: ${formatErrorWithCauses(error instanceof Error ? error : new Error(String(error)))}`,
					"REVERT_FAILED",
					error
				)
			)
		);
	}

	getFileContentAtCheckpoint(
		sessionId: string,
		checkpointId: string,
		filePath: string
	): Effect.Effect<string, CheckpointError> {
		const store = this;
		return Effect.gen(function* () {
			let rows = store.getCheckpoints(sessionId);
			if (rows.length === 0) {
				rows = yield* store.loadCheckpoints(sessionId);
			}
			const checkpoint = findCheckpoint(rows, checkpointId);
			const file = checkpoint === undefined ? undefined : findFile(checkpoint, filePath);
			if (file === undefined) {
				return yield* Effect.fail(
					new CheckpointError(`Failed to get file content: not in snapshot`, "FILE_NOT_FOUND")
				);
			}
			return file.content;
		});
	}

	getFileDiffContentAtCheckpoint(
		sessionId: string,
		checkpointId: string,
		filePath: string
	): Effect.Effect<FileDiffContent, CheckpointError> {
		const store = this;
		return Effect.gen(function* () {
			let rows = store.getCheckpoints(sessionId);
			if (rows.length === 0) {
				rows = yield* store.loadCheckpoints(sessionId);
			}
			const checkpoint = findCheckpoint(rows, checkpointId);
			const file = checkpoint === undefined ? undefined : findFile(checkpoint, filePath);
			if (checkpoint === undefined || file === undefined) {
				return yield* Effect.fail(
					new CheckpointError(`Failed to get file diff content: not in snapshot`, "FILE_NOT_FOUND")
				);
			}
			return {
				oldContent: previousFileContent(rows, checkpoint, filePath),
				newContent: file.content
			};
		});
	}

	getFileSnapshotsForCheckpoint(
		sessionId: string,
		checkpointId: string
	): Effect.Effect<FileSnapshot[], CheckpointError> {
		const store = this;
		return Effect.gen(function* () {
			let rows = store.getCheckpoints(sessionId);
			if (rows.length === 0) {
				rows = yield* store.loadCheckpoints(sessionId);
			}
			const checkpoint = findCheckpoint(rows, checkpointId);
			if (checkpoint === undefined) {
				return yield* Effect.fail(
					new CheckpointError(`Failed to get file snapshots: not in snapshot`, "STORAGE_ERROR")
				);
			}
			return checkpoint.files ?? [];
		});
	}

	clearCheckpoints(sessionId: string): void {
		this.checkpointsBySession.delete(sessionId);
	}
}

export const checkpointStore = new CheckpointStore();
