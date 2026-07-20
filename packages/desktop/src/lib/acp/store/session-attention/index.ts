/**
 * Session attention store module.
 * Shared helpers for building and deriving session attention items (formerly queue items).
 */

export type { AttentionKind, SessionAttentionEntry } from "./attention-kind.js";
export { selectAttentionKind } from "./attention-kind.js";
export { attentionStatusColor } from "./attention-status-color.js";
export type { QueueItem, SessionAttentionItem } from "./types.js";
export {
	type BuildQueueSessionSnapshotInput,
	buildQueueItem,
	buildQueueSessionSnapshot,
	calculateSessionUrgency,
	deriveQueueSessionState,
	type ProjectBadgeLabelLookup,
	type ProjectColorLookup,
	type ProjectIconSrcLookup,
	type QueueSessionSnapshot,
	type QueueSessionStateInput,
} from "./utils.js";
