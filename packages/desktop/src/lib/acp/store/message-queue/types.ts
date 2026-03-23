import type { Attachment } from "../../components/agent-input/types/attachment.js";

/**
 * A message waiting in the per-session queue.
 *
 * Created when the user sends while the agent is busy.
 * Drained automatically when the agent finishes its turn.
 */
export interface QueuedMessage {
	readonly id: string;
	readonly content: string;
	readonly attachments: readonly Attachment[];
	readonly queuedAt: number;
}
