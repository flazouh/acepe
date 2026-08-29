/**
 * Git queries and worktree disk operations for the agent panel (branch label, presence, dirty state, remove).
 */

import * as Effect from "effect/Effect";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { backendClient } from "$lib/utils/backend-client.js";

/** Resolves the current branch name for display (errors surface as empty branch in the panel lookup). */
export function fetchPanelGitBranch(path: string): Effect.Effect<string, AppError> {
	return backendClient.git.currentBranch(path);
}

/** Whether `worktreePath` is still listed under the project (git worktree list). */
export function fetchWorktreePathListedForProject(
	projectPath: string,
	worktreePath: string
): Effect.Effect<boolean, AppError> {
	return backendClient.git
		.worktreeList(projectPath)
		.pipe(Effect.map((list) => list.some((wt) => wt.directory === worktreePath)));
}

/** Dirty working tree check for close-confirm UX. */
export function fetchWorktreeHasUncommittedChanges(
	worktreePath: string
): Effect.Effect<boolean, AppError> {
	return backendClient.git.hasUncommittedChanges(worktreePath);
}

export function removeWorktreeFromDisk(
	worktreePath: string,
	force: boolean
): Effect.Effect<void, AppError> {
	return backendClient.git.worktreeRemove(worktreePath, force);
}
