/**
 * Mid-session worktree switch service (Continue-only path).
 *
 * The runtime move is owned by Rust. This service intentionally does not use
 * first-send prepared launches, launch tokens, or panel pending-worktree state.
 */

import { errAsync, type ResultAsync } from "neverthrow";

import { type AppError, ValidationError } from "$lib/acp/errors/app-error.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { WorktreeInfo } from "../../../types/worktree-info.js";

export interface MidSessionWorktreeSwitchResult {
	readonly worktree: WorktreeInfo;
	readonly worktreePath: string;
}

export function switchActiveSessionToWorktree(args: {
	sessionId: string;
	projectPath: string;
	agentId: string;
}): ResultAsync<MidSessionWorktreeSwitchResult, AppError> {
	const { sessionId, projectPath, agentId } = args;

	if (!sessionId) {
		return errAsync(
			new ValidationError("Cannot switch worktree without an active session.", "sessionId")
		);
	}
	if (!projectPath) {
		return errAsync(
			new ValidationError("Cannot switch worktree without a project path.", "projectPath")
		);
	}
	if (!agentId) {
		return errAsync(
			new ValidationError("Cannot switch worktree without a selected agent.", "agentId")
		);
	}

	return tauriClient.acp
		.switchSessionToWorktree(sessionId, projectPath, agentId)
		.map((response) => ({
			worktree: response.worktree,
			worktreePath: response.worktree.directory,
		}));
}
