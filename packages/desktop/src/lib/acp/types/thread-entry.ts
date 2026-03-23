import type { AskMessage } from "./ask-message.js";
import type { AssistantMessage } from "./assistant-message.js";
import type { ToolCall } from "./tool-call.js";
import type { UserMessage } from "./user-message.js";

/**
 * Base properties shared by all thread entries.
 */
interface ThreadEntryBase {
	/**
	 * Unique identifier for this entry.
	 */
	id: string;
	/**
	 * Timestamp when this entry was created.
	 * Used for calculating task durations in todo lists.
	 */
	timestamp?: Date;
}

/**
 * Entry in an agent thread.
 *
 * Represents a single entry in the conversation thread,
 * which can be a user message, assistant message, ask message, or tool call.
 */
export type ThreadEntry =
	| (ThreadEntryBase & { type: "user"; message: UserMessage })
	| (ThreadEntryBase & { type: "assistant"; message: AssistantMessage })
	| (ThreadEntryBase & { type: "ask"; message: AskMessage })
	| (ThreadEntryBase & { type: "tool_call"; toolCall: ToolCall });
