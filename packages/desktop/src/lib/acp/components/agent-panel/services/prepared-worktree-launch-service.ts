/**
 * Product intent: discard a prepared worktree session launch (Tauri git).
 * Centralizes direct `tauriClient.git` calls so panel UI stays thin.
 */

import { tauriClient } from "$lib/utils/tauri-client.js";

export function discardPreparedWorktreeSessionLaunch(
	launchToken: string,
	deleteWorktree: boolean
) {
	return tauriClient.git.discardPreparedWorktreeSessionLaunch(launchToken, deleteWorktree);
}
