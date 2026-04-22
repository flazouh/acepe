/**
 * Persists session fields to the local history DB from panel workflows (PR#, worktree path).
 */

import type { ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

export function persistSessionPrNumber(
	sessionId: string,
	prNumber: number
): ResultAsync<void, AppError> {
	return tauriClient.history.setSessionPrNumber(sessionId, prNumber);
}

export function persistSessionWorktreePathAfterRename(
	sessionId: string,
	worktreePath: string,
	projectPath: string | undefined,
	agentId: string | undefined
): ResultAsync<void, AppError> {
	return tauriClient.history.setSessionWorktreePath(sessionId, worktreePath, projectPath, agentId);
}
