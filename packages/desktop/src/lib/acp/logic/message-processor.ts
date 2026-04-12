import { ok, type Result } from "neverthrow";

import type {
	ContentBlock,
	ContentChunk,
	SessionUpdate,
} from "../../services/converted-session-types.js";
import type { AcpError } from "../errors/index.js";
import type { AssistantMessage, AssistantMessageChunk } from "../types/assistant-message.js";
import type { ThreadEntry } from "../types/thread-entry.js";
import type { ToolCall } from "../types/tool-call.js";
import type { UserMessage } from "../types/user-message.js";

import { stripThoughtPrefix } from "../utils/thought-prefix-stripper.js";
import { matchSessionUpdate } from "./session-update-matcher.js";

/**
 * Processes session updates and transforms them into thread entries.
 *
 * This processor handles the conversion of ACP protocol session updates
 * into thread entries that can be stored and displayed in the UI.
 *
 * Uses type-safe pattern matching to ensure exhaustive handling of all SessionUpdate variants.
 */
export class MessageProcessor {
	/**
	 * @param idGenerator - Function to generate unique IDs for entries. Injectable for testing.
	 */
	constructor(private idGenerator: () => string = () => crypto.randomUUID()) {}

	/**
	 * Process a session update and convert it to a thread entry.
	 *
	 * Uses exhaustive pattern matching - all SessionUpdate variants must be handled.
	 *
	 * @param update - The session update to process
	 * @returns Result containing the thread entry or null for metadata updates
	 */
	processUpdate(update: SessionUpdate): Result<ThreadEntry | null, AcpError> {
		return matchSessionUpdate<Result<ThreadEntry | null, AcpError>>(update, {
			userMessageChunk: (data) => this.processUserChunk(data.chunk),
			agentMessageChunk: (data) => this.processAgentChunk(data.chunk, data.message_id, false),
			agentThoughtChunk: (data) => this.processAgentChunk(data.chunk, data.message_id, true),
			toolCall: (data) => this.processToolCall(data.tool_call),
			toolCallUpdate: () => ok(null),
			plan: () => ok(null),
			availableCommandsUpdate: () => ok(null),
			currentModeUpdate: () => ok(null),
			configOptionUpdate: () => ok(null),
			permissionRequest: () => ok(null),
			questionRequest: () => ok(null),
			turnComplete: () => ok(null), // TurnComplete is handled at the event service layer
			turnError: () => ok(null), // TurnError is handled at the event service layer
			usageTelemetryUpdate: () => ok(null), // Telemetry is handled at the event service layer
			connectionComplete: () => ok(null), // Lifecycle event handled at connection manager layer
			connectionFailed: () => ok(null), // Lifecycle event handled at connection manager layer
		});
	}

	/**
	 * Process a user message chunk into a thread entry.
	 */
	private processUserChunk(chunk: ContentChunk): Result<ThreadEntry, AcpError> {
		const message: UserMessage = {
			content: chunk.content,
			chunks: [chunk.content],
		};
		return ok({
			id: this.idGenerator(),
			type: "user",
			message,
			timestamp: new Date(),
		});
	}

	/**
	 * Process an agent message/thought chunk into a thread entry.
	 */
	private processAgentChunk(
		contentChunk: ContentChunk,
		_messageId: string | null | undefined,
		isThought: boolean
	): Result<ThreadEntry, AcpError> {
		const content = contentChunk.content;
		const normalizedContent = isThought ? this.normalizeThoughtContent(content) : content;

		const messageChunk: AssistantMessageChunk = {
			type: isThought ? "thought" : "message",
			block: normalizedContent,
		};
		const message: AssistantMessage = {
			chunks: [messageChunk],
		};
		return ok({
			id: this.idGenerator(),
			type: "assistant",
			message,
			timestamp: new Date(),
		});
	}

	/**
	 * Process a tool call into a thread entry.
	 */
	private processToolCall(toolCall: ToolCall): Result<ThreadEntry, AcpError> {
		return ok({
			id: toolCall.id,
			type: "tool_call",
			toolCall,
			timestamp: new Date(),
		});
	}

	/**
	 * Merge a user message chunk into an existing user message.
	 */
	mergeUserMessageChunk(existing: UserMessage, chunk: ContentChunk): UserMessage {
		return {
			...existing,
			chunks: [...existing.chunks, chunk.content as ContentBlock],
			content: this.combineContentBlocks([...existing.chunks, chunk.content as ContentBlock]),
		};
	}

	/**
	 * Merge an assistant message chunk into an existing assistant message.
	 */
	mergeAssistantMessageChunk(
		existing: AssistantMessage,
		chunk: ContentChunk,
		isThought: boolean
	): AssistantMessage {
		const content = chunk.content as ContentBlock;
		const normalizedContent = isThought ? this.normalizeThoughtContent(content) : content;

		const newChunk: AssistantMessageChunk = {
			type: isThought ? "thought" : "message",
			block: normalizedContent,
		};
		return {
			chunks: [...existing.chunks, newChunk],
		};
	}

	/**
	 * Normalize thought content by stripping redundant prefixes.
	 *
	 * Some agent adapters (like cursor-agent-acp) add prefixes like "[Thinking]"
	 * to thought content for terminal display. Since we already distinguish
	 * thought chunks semantically via the chunk type, these prefixes are redundant.
	 */
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

	/**
	 * Combine multiple content blocks into a single content block.
	 *
	 * Optimized to use single string allocation via Array.join().
	 */
	private combineContentBlocks(blocks: ContentBlock[]): ContentBlock {
		if (blocks.length === 0) {
			return { type: "text", text: "" };
		}
		if (blocks.length === 1) {
			return blocks[0];
		}

		// Extract text content from text blocks only, join with single allocation
		const texts = blocks
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text);

		return texts.length > 0 ? { type: "text", text: texts.join("") } : blocks[0];
	}
}
