import type { MessageQueueStore } from "../../../store/message-queue/message-queue-store.svelte.js";
import {
	queuedMessageId,
	type QueuedMessageId,
} from "../../../store/message-queue/types.js";
import type { Attachment } from "../../agent-input/types/attachment.js";

type QueuedMessage = {
	id: string;
	content: string;
	attachments: readonly Attachment[];
};

export type AgentInputQueueRestore = {
	restoreQueuedMessage: (draft: string, attachments: readonly Attachment[]) => void;
};

/** Cancel a queued message and restore its text into the composer. */
export function cancelQueuedMessageAndRestoreInput(options: {
	sessionId: string;
	messageId: QueuedMessageId;
	queueMessages: readonly QueuedMessage[];
	agentInputRef: AgentInputQueueRestore | null;
	messageQueueStore: MessageQueueStore;
}): void {
	const { sessionId, messageId, queueMessages, agentInputRef, messageQueueStore } = options;
	if (!agentInputRef) {
		return;
	}
	const queuedMessage = queueMessages.find((message) => queuedMessageId(message) === messageId);
	if (!queuedMessage) {
		return;
	}
	agentInputRef.restoreQueuedMessage(queuedMessage.content, queuedMessage.attachments);
	messageQueueStore.removeMessage(sessionId, messageId);
}

export function removeAttachmentFromQueuedMessage(options: {
	sessionId: string;
	messageId: QueuedMessageId;
	attachmentId: string;
	messageQueueStore: MessageQueueStore;
}): void {
	options.messageQueueStore.removeAttachmentFromMessage(
		options.sessionId,
		options.messageId,
		options.attachmentId
	);
}

export function clearMessageQueue(options: {
	sessionId: string;
	messageQueueStore: MessageQueueStore;
}): void {
	options.messageQueueStore.clearQueue(options.sessionId);
}

export function sendQueuedMessageNow(options: {
	sessionId: string;
	messageId: QueuedMessageId;
	messageQueueStore: MessageQueueStore;
}): void {
	options.messageQueueStore.sendNow(options.sessionId, options.messageId);
}
