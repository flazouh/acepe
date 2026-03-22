/**
 * Queue module - Cross-project session queue with urgency-based ordering.
 */

export {
	createQueueStore,
	getQueueStore,
	type QueueSectionGroup,
	type QueueSectionId,
	type QueueStore,
	type QueueUpdateInput,
} from "./queue-store.svelte.js";
export type { QueueItem } from "./types.js";
export { buildQueueItem, calculateSessionUrgency, type ProjectColorLookup } from "./utils.js";
