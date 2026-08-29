/**
 * Persists session fields to the local history DB from panel workflows (PR#, worktree path).
 */

import type * as Effect from "effect/Effect";
import type { SessionPrLinkMode } from "$lib/acp/application/dto/session-linked-pr.js";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { backendClient } from "$lib/utils/backend-client.js";

export function persistSessionPrNumber(
	sessionId: string,
	prNumber: number | null,
	prLinkMode?: SessionPrLinkMode | null
): Effect.Effect<void, AppError> {
	return backendClient.history.setSessionPrNumber(sessionId, prNumber, prLinkMode);
}

export function persistSessionWorktreePathAfterRename(
	sessionId: string,
	worktreePath: string,
	projectPath: string | undefined,
	agentId: string | undefined
): Effect.Effect<void, AppError> {
	return backendClient.history.setSessionWorktreePath(sessionId, worktreePath, projectPath, agentId);
}
