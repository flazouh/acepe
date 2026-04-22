/**
 * Checkpoint list loading for the panel timeline (open + post-revert refresh).
 */

import { checkpointStore } from "../../../store/checkpoint-store.svelte.js";

/** Await before first opening the timeline so the list is populated. */
export async function loadCheckpointsBeforeTimelineOpen(sessionId: string): Promise<void> {
	await checkpointStore.loadCheckpoints(sessionId).match(
		() => undefined,
		() => undefined
	);
}

/** Fire-and-forget reload after revert (new safety checkpoint may exist). */
export function scheduleCheckpointReloadAfterRevert(sessionId: string): void {
	void checkpointStore.loadCheckpoints(sessionId).match(
		() => {},
		() => {}
	);
}
