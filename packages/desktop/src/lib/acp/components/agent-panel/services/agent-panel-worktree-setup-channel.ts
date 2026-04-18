/**
 * Tauri `git:worktree-setup` event channel — keeps `@tauri-apps/api/event` usage out of panel UI.
 */

import { listen } from "@tauri-apps/api/event";
import type { WorktreeSetupEvent } from "../../../types/worktree-setup.js";

/**
 * Subscribe to worktree setup progress emitted from the backend.
 * @returns The same unsubscribe function as `listen` from `@tauri-apps/api/event`.
 */
export function subscribeGitWorktreeSetupChannel(
	onPayload: (payload: WorktreeSetupEvent) => void
): Promise<() => void> {
	return listen<WorktreeSetupEvent>("git:worktree-setup", (event) => {
		onPayload(event.payload);
	}).then((unlisten) => unlisten);
}
