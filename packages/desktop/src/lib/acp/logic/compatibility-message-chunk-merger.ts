import type { ContentBlock, ContentChunk } from "../../services/converted-session-types.js";
import type { AssistantMessage, AssistantMessageChunk } from "../types/assistant-message.js";
import type { UserMessage } from "../types/user-message.js";
import { stripThoughtPrefix } from "../utils/thought-prefix-stripper.js";

/**
 * Compatibility-only chunk merger for legacy transcript-row tests.
 *
 * Product transcript rows are built from canonical Rust snapshots and deltas.
 * This helper must not grow back into a raw SessionUpdate-to-display-entry converter.
 */
export class CompatibilityMessageChunkMerger {
	mergeUserMessageChunk(existing: UserMessage, chunk: ContentChunk): UserMessage {
		const chunks = existing.chunks.concat([chunk.content as ContentBlock]);
		const nextMessage: UserMessage = {
			content: this.combineContentBlocks(chunks),
			chunks,
		};

		if (existing.id !== undefined) {
			nextMessage.id = existing.id;
		}
		if (existing.sentAt !== undefined) {
			nextMessage.sentAt = existing.sentAt;
		}
		if (existing.checkpoint !== undefined) {
			nextMessage.checkpoint = existing.checkpoint;
		}

		return nextMessage;
	}

	mergeAssistantMessageChunk(
		existing: AssistantMessage,
		chunk: ContentChunk,
		isThought: boolean
	): AssistantMessage {
		const content = chunk.content as ContentBlock;
		const normalizedContent = isThought ? this.normalizeThoughtContent(content) : content;
		const nextChunk: AssistantMessageChunk = {
			type: isThought ? "thought" : "message",
			block: normalizedContent,
		};
		const nextMessage: AssistantMessage = {
			chunks: existing.chunks.concat([nextChunk]),
		};

		if (existing.model !== undefined) {
			nextMessage.model = existing.model;
		}
		if (existing.displayModel !== undefined) {
			nextMessage.displayModel = existing.displayModel;
		}
		if (existing.receivedAt !== undefined) {
			nextMessage.receivedAt = existing.receivedAt;
		}
		if (existing.thinkingDurationMs !== undefined) {
			nextMessage.thinkingDurationMs = existing.thinkingDurationMs;
		}

		return nextMessage;
	}

	private normalizeThoughtContent(content: ContentBlock): ContentBlock {
		if (content.type !== "text") {
			return content;
		}
		const normalizedText = stripThoughtPrefix(content.text);
		if (normalizedText === content.text) {
			return content;
		}
		return { type: "text", text: normalizedText };
	}

	private combineContentBlocks(blocks: ContentBlock[]): ContentBlock {
		if (blocks.length === 0) {
			return { type: "text", text: "" };
		}
		if (blocks.length === 1) {
			return blocks[0];
		}

		const texts = blocks
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text);

		return texts.length > 0 ? { type: "text", text: texts.join("") } : blocks[0];
	}
}
