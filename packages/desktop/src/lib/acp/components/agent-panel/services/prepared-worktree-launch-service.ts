/**
 * Product intent: discard a prepared worktree session launch (Tauri git).
 * Centralizes direct `backendClient.git` calls so panel UI stays thin.
 */

import { backendClient } from "$lib/utils/backend-client.js";

export function discardPreparedWorktreeSessionLaunch(launchToken: string, deleteWorktree: boolean) {
	return backendClient.git.discardPreparedWorktreeSessionLaunch(launchToken, deleteWorktree);
}
