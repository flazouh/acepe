import type { ContentBlock } from "../../services/converted-session-types.js";

/**
 * Assistant message chunk.
 *
 * Represents a chunk of content from the assistant.
 */
export type AssistantMessageChunk = {
	/**
	 * Type of chunk (message or thought).
	 */
	type: "message" | "thought";

	/**
	 * Content block for this chunk.
	 */
	block: ContentBlock;
};

/**
 * Assistant message in a thread.
 *
 * Represents a message from the assistant to the user.
 */
export type AssistantMessage = {
	/**
	 * Chunks that make up this message.
	 */
	chunks: AssistantMessageChunk[];

	/**
	 * Raw model ID (e.g., "claude-opus-4-5-20251101").
	 */
	model?: string;

	/**
	 * User-friendly model display name (e.g., "Opus 4.5").
	 * Falls back to model if not available.
	 */
	displayModel?: string;

	/**
	 * Timestamp when the assistant message was first received.
	 *
	 * Used to display message timing and measure response latency.
	 */
	receivedAt?: Date;

	/**
	 * Thinking phase duration in milliseconds (when available).
	 * Used to show "Thinking for Xs" while streaming and "Thought for Xs" after completion.
	 */
	thinkingDurationMs?: number;
};
