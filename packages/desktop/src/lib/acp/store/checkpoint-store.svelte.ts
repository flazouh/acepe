/**
 * Checkpoint store for file versioning and revert functionality.
 *
 * This store provides reactive state management for checkpoints and
 * wraps the Tauri commands with ResultAsync error handling.
 */

import { errAsync, type ResultAsync } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";
import type { FileDiffContent } from "../../services/checkpoint-types.js";
import { tauriClient } from "../../utils/tauri-client.js";
import { CheckpointError } from "../errors/checkpoint-error.js";
import { formatErrorWithCauses } from "../errors/error-cause-details.js";
import type { Checkpoint, FileSnapshot, RevertResult } from "../types/checkpoint.js";

/**
 * Store for managing checkpoint state and operations.
 *
 * Provides methods for:
 * - Creating checkpoints (auto and manual)
 * - Loading checkpoints for a session
 * - Reverting files to checkpoint state
 */
export class CheckpointStore {
	/** Checkpoints indexed by session ID, ordered by checkpoint_number DESC */
	private checkpointsBySession = new SvelteMap<string, Checkpoint[]>();

	/** Loading state for UI feedback */
	isLoading = $state(false);

	/**
	 * Get checkpoints for a session from the local cache.
	 *
	 * Returns an empty array if checkpoints haven't been loaded yet.
	 */
	getCheckpoints(sessionId: string): Checkpoint[] {
		return this.checkpointsBySession.get(sessionId) ?? [];
	}

	/**
	 * Load checkpoints for a session from the backend.
	 *
	 * Updates the local cache and returns the loaded checkpoints.
	 */
	loadCheckpoints(sessionId: string): ResultAsync<Checkpoint[], CheckpointError> {
		this.isLoading = true;

		return tauriClient.checkpoint
			.list(sessionId)
			.mapErr(
				(e) => new CheckpointError(`Failed to load checkpoints: ${e.message}`, "STORAGE_ERROR", e)
			)
			.map((checkpoints) => {
				this.checkpointsBySession.set(sessionId, checkpoints);
				this.isLoading = false;
				return checkpoints;
			})
			.orElse((error) => {
				this.isLoading = false;
				return errAsync(error);
			});
	}

	/**
	 * Create a new checkpoint for a session.
	 *
	 * The checkpoint captures the current state of the specified files.
	 * The new checkpoint is prepended to the local cache.
	 *
	 * Accepts absolute or relative file paths. Absolute paths are converted
	 * to relative paths by the Rust backend using worktreePath or projectPath.
	 *
	 * @param sessionId - The session ID
	 * @param projectPath - Absolute path to the project root
	 * @param modifiedFiles - File paths (absolute or relative)
	 * @param options - Optional checkpoint settings
	 */
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
	): ResultAsync<Checkpoint, CheckpointError> {
		return tauriClient.checkpoint
			.create(sessionId, projectPath, modifiedFiles, options)
			.mapErr((e) => {
				const detailedMessage = formatErrorWithCauses(e);
				return new CheckpointError(
					`Failed to create checkpoint: ${detailedMessage}`,
					"CREATE_FAILED",
					e
				);
			})
			.map((checkpoint) => {
				// Prepend to existing list (newest first)
				const existing = this.checkpointsBySession.get(sessionId) ?? [];
				this.checkpointsBySession.set(sessionId, [checkpoint, ...existing]);
				return checkpoint;
			});
	}

	/**
	 * Revert all files to their state at a specific checkpoint.
	 *
	 * This writes the checkpoint's file contents to disk, overwriting
	 * the current file contents. A safety checkpoint of the current state
	 * is automatically created before reverting.
	 *
	 * @param sessionId - The session ID (for access control verification)
	 * @param checkpointId - The checkpoint to revert to
	 * @param projectPath - Absolute path to the project root
	 */
	revertToCheckpoint(
		sessionId: string,
		checkpointId: string,
		projectPath: string
	): ResultAsync<RevertResult, CheckpointError> {
		return tauriClient.checkpoint
			.revert(sessionId, checkpointId, projectPath)
			.mapErr((e) => new CheckpointError(`Failed to revert: ${e.message}`, "REVERT_FAILED", e));
	}

	/**
	 * Revert a single file to its state at a specific checkpoint.
	 *
	 * @param sessionId - The session ID (for access control verification)
	 * @param checkpointId - The checkpoint to revert from
	 * @param filePath - Relative path of the file to revert
	 * @param projectPath - Absolute path to the project root
	 */
	revertFile(
		sessionId: string,
		checkpointId: string,
		filePath: string,
		projectPath: string
	): ResultAsync<void, CheckpointError> {
		return tauriClient.checkpoint
			.revertFile(sessionId, checkpointId, filePath, projectPath)
			.mapErr(
				(e) => new CheckpointError(`Failed to revert file: ${e.message}`, "REVERT_FAILED", e)
			);
	}

	/**
	 * Get the content of a file at a specific checkpoint.
	 *
	 * Useful for showing diffs or previewing file state.
	 *
	 * @param sessionId - The session ID (for access control verification)
	 * @param checkpointId - The checkpoint to read from
	 * @param filePath - Relative path of the file
	 */
	getFileContentAtCheckpoint(
		sessionId: string,
		checkpointId: string,
		filePath: string
	): ResultAsync<string, CheckpointError> {
		return tauriClient.checkpoint
			.getFileContent(sessionId, checkpointId, filePath)
			.mapErr(
				(e) => new CheckpointError(`Failed to get file content: ${e.message}`, "FILE_NOT_FOUND", e)
			);
	}

	/**
	 * Get old and new file content for diff display at a checkpoint.
	 *
	 * @param sessionId - The session ID (for access control verification)
	 * @param checkpointId - The checkpoint to read from
	 * @param filePath - Relative path of the file
	 */
	getFileDiffContentAtCheckpoint(
		sessionId: string,
		checkpointId: string,
		filePath: string
	): ResultAsync<FileDiffContent, CheckpointError> {
		return tauriClient.checkpoint
			.getFileDiffContent(sessionId, checkpointId, filePath)
			.mapErr(
				(e) =>
					new CheckpointError(`Failed to get file diff content: ${e.message}`, "FILE_NOT_FOUND", e)
			);
	}

	/**
	 * Get file snapshots for a specific checkpoint.
	 *
	 * @param sessionId - The session ID (for access control verification)
	 * @param checkpointId - The checkpoint to get files for
	 */
	getFileSnapshotsForCheckpoint(
		sessionId: string,
		checkpointId: string
	): ResultAsync<FileSnapshot[], CheckpointError> {
		return tauriClient.checkpoint
			.getFileSnapshots(sessionId, checkpointId)
			.mapErr(
				(e) => new CheckpointError(`Failed to get file snapshots: ${e.message}`, "STORAGE_ERROR", e)
			);
	}

	/**
	 * Clear the local checkpoint cache for a session.
	 *
	 * Does not delete checkpoints from the database.
	 */
	clearCheckpoints(sessionId: string): void {
		this.checkpointsBySession.delete(sessionId);
	}
}

/**
 * Singleton instance of the checkpoint store.
 */
export const checkpointStore = new CheckpointStore();
