/**
 * MessageQueueStore - Per-session message queue for stacking messages.
 *
 * When the agent is busy (streaming/thinking), messages are queued here
 * instead of sent immediately. When the agent finishes its turn, the queue
 * drains the next message automatically via the onTurnComplete callback.
 */

import type { ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

import type { Attachment } from "../../components/agent-input/types/attachment.js";
import type { AppError } from "../../errors/app-error.js";
import { createLogger } from "../../utils/logger.js";
import type { QueuedMessage } from "./types.js";

const logger = createLogger({ id: "message-queue-store", name: "MessageQueueStore" });

const MESSAGE_QUEUE_KEY = Symbol("message-queue");
const MAX_QUEUE_SIZE = 5;
const EMPTY_QUEUE: readonly QueuedMessage[] = [];

/**
 * Serialize attachments into token format for sending.
 * Extracted from AgentInputState.sendMessage for reuse.
 */
export function serializeWithAttachments(
	content: string,
	attachments: readonly Attachment[]
): string {
	if (attachments.length === 0) return content;

	const tokens = attachments
		.map((a) => {
			if (a.type === "text" && a.content) {
				const base64Content = btoa(unescape(encodeURIComponent(a.content)));
				return `@[${a.type}:${base64Content}]`;
			}
			return `@[${a.type}:${a.path}]`;
		})
		.join(" ");

	return `${tokens}\n${content}`;
}

/**
 * Minimal interface for the send capability the queue needs.
 */
export interface MessageSender {
	sendMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[]
	): ResultAsync<void, AppError>;
}

export interface MessageQueueStore {
	getQueue(sessionId: string): readonly QueuedMessage[];
	/** Enqueue a message. Returns false if the queue is full. */
	enqueue(sessionId: string, content: string, attachments: readonly Attachment[]): boolean;
	removeMessage(sessionId: string, messageId: string): void;
	clearQueue(sessionId: string): void;
	drainNext(sessionId: string): void;
	pause(sessionId: string): void;
	resume(sessionId: string): void;
	isPaused(sessionId: string): boolean;
	removeForSession(sessionId: string): void;
	queueCount(sessionId: string): number;
}

/**
 * Create a reactive message queue store and set it in Svelte context.
 */
export function createMessageQueueStore(sender: MessageSender): MessageQueueStore {
	// Per-session queues — SvelteMap for reactivity
	const queues = new SvelteMap<string, QueuedMessage[]>();
	// Paused sessions — SvelteSet for reactivity (UI reads isPaused)
	const pausedIds = new SvelteSet<string>();
	// Draining sessions — plain Set (intentionally non-reactive, no UI reads this)
	const drainingIds = new Set<string>();

	function getQueue(sessionId: string): readonly QueuedMessage[] {
		return queues.get(sessionId) ?? EMPTY_QUEUE;
	}

	function enqueue(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[]
	): boolean {
		const queue = queues.get(sessionId) ?? [];
		if (queue.length >= MAX_QUEUE_SIZE) {
			logger.debug("Queue full, rejecting", { sessionId, size: queue.length });
			return false;
		}

		const message: QueuedMessage = {
			id: crypto.randomUUID(),
			content,
			attachments: [...attachments],
			queuedAt: Date.now(),
		};

		queues.set(sessionId, [...queue, message]);
		logger.debug("Message enqueued", {
			sessionId,
			messageId: message.id,
			queueSize: queue.length + 1,
		});
		return true;
	}

	function removeMessage(sessionId: string, messageId: string): void {
		const queue = queues.get(sessionId);
		if (!queue) return;

		const filtered = queue.filter((m) => m.id !== messageId);
		if (filtered.length === 0) {
			queues.delete(sessionId);
		} else {
			queues.set(sessionId, filtered);
		}
	}

	function clearQueue(sessionId: string): void {
		queues.delete(sessionId);
		logger.debug("Queue cleared", { sessionId });
	}

	function drainNext(sessionId: string): void {
		if (pausedIds.has(sessionId)) return;
		if (drainingIds.has(sessionId)) return;

		const queue = queues.get(sessionId);
		if (!queue?.length) return;

		const [next, ...rest] = queue;
		if (rest.length > 0) {
			queues.set(sessionId, rest);
		} else {
			queues.delete(sessionId);
		}

		drainingIds.add(sessionId);

		logger.debug("Draining next message", { sessionId, messageId: next.id });

		sender
			.sendMessage(sessionId, next.content, next.attachments)
			.map(() => {
				drainingIds.delete(sessionId);
				// Don't drain again here — next onTurnComplete will trigger
			})
			.mapErr((error) => {
				// Send failed — re-insert at front and pause
				const current = queues.get(sessionId) ?? [];
				queues.set(sessionId, [next, ...current]);
				drainingIds.delete(sessionId);
				pausedIds.add(sessionId);
				logger.warn("Drain failed, re-inserted and paused", {
					sessionId,
					messageId: next.id,
					error,
				});
			});
	}

	function pause(sessionId: string): void {
		pausedIds.add(sessionId);
		logger.debug("Queue paused", { sessionId });
	}

	function resume(sessionId: string): void {
		pausedIds.delete(sessionId);
		logger.debug("Queue resumed", { sessionId });
		drainNext(sessionId);
	}

	function isPaused(sessionId: string): boolean {
		return pausedIds.has(sessionId);
	}

	function removeForSession(sessionId: string): void {
		queues.delete(sessionId);
		pausedIds.delete(sessionId);
		drainingIds.delete(sessionId);
	}

	function queueCount(sessionId: string): number {
		return getQueue(sessionId).length;
	}

	const store: MessageQueueStore = {
		getQueue,
		enqueue,
		removeMessage,
		clearQueue,
		drainNext,
		pause,
		resume,
		isPaused,
		removeForSession,
		queueCount,
	};

	setContext(MESSAGE_QUEUE_KEY, store);
	return store;
}

/**
 * Get the message queue store from Svelte context.
 */
export function getMessageQueueStore(): MessageQueueStore {
	return getContext<MessageQueueStore>(MESSAGE_QUEUE_KEY);
}
