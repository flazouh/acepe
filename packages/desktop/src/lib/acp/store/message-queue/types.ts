import type { Attachment } from "../../components/agent-input/types/attachment.js";

export type QueuedMessageId = string;

/**
 * A message waiting in the per-session queue.
 *
 * Created when the user sends while the agent is busy.
 * Drained automatically when the agent finishes its turn.
 */
export interface QueuedMessage {
	readonly id: QueuedMessageId;
	readonly content: string;
	readonly attachments: readonly Attachment[];
	readonly queuedAt: number;
}

/**
 * Local queue identity for a queued composer draft.
 *
 * This id is not a transcript id and is not sent to the provider.
 */
export function queuedMessageId(message: Pick<QueuedMessage, "id">): QueuedMessageId {
	return message.id;
}
