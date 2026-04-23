/**
 * ACP protocol ContentBlock types.
 * Mirrors the Rust backend enum structure exactly.
 *
 * @see https://agentclientprotocol.com/protocol/schema#contentblock
 */
export type EmbeddedResource = {
	uri: string;
	text?: string;
	blob?: string;
	mimeType?: string;
};

export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string; uri?: string }
	| { type: "audio"; data: string; mimeType: string }
	| { type: "resource"; resource: EmbeddedResource }
	| {
			type: "resource_link";
			uri: string;
			name: string;
			title?: string;
			description?: string;
			mimeType?: string;
			size?: number;
	  };

/**
 * A single chunk of content from the assistant (message or thought).
 */
export type AssistantMessageChunk = {
	type: "message" | "thought";
	block: ContentBlock;
};

/**
 * An assistant message made up of one or more chunks.
 */
export type AssistantMessage = {
	chunks: AssistantMessageChunk[];
	model?: string;
	displayModel?: string;
	receivedAt?: Date;
	/** Thinking phase duration in milliseconds */
	thinkingDurationMs?: number;
};

export const STREAMING_ANIMATION_MODE_SMOOTH = "smooth";
export const STREAMING_ANIMATION_MODE_INSTANT = "instant";

export type StreamingAnimationMode = "smooth" | "instant";

export const DEFAULT_STREAMING_ANIMATION_MODE: StreamingAnimationMode =
	STREAMING_ANIMATION_MODE_SMOOTH;
