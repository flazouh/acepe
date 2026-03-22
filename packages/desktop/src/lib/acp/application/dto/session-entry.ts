import type { AskMessage } from "../../types/ask-message";
import type { AssistantMessage } from "../../types/assistant-message";
import type { ErrorMessage } from "../../types/error-message.js";
import type { ToolCall } from "../../types/tool-call";
import type { UserMessage } from "../../types/user-message";

/**
 * Base properties shared by all entry types.
 */
interface SessionEntryBase {
	readonly id: string;
	readonly timestamp?: Date;
	readonly isStreaming?: boolean;
}

/**
 * Session entry - discriminated union for type-safe message access.
 *
 * When you check `entry.type`, TypeScript automatically narrows the `message` type:
 * ```ts
 * if (entry.type === 'user') {
 *   // TypeScript knows entry.message is UserMessage
 *   console.log(entry.message.content);
 * }
 * ```
 */
export type SessionEntry =
	| (SessionEntryBase & {
			readonly type: "user";
			readonly message: UserMessage;
	  })
	| (SessionEntryBase & {
			readonly type: "assistant";
			readonly message: AssistantMessage;
	  })
	| (SessionEntryBase & {
			readonly type: "tool_call";
			readonly message: ToolCall;
	  })
	| (SessionEntryBase & { readonly type: "ask"; readonly message: AskMessage })
	| (SessionEntryBase & {
			readonly type: "error";
			readonly message: ErrorMessage;
	  });

/** Type guard: narrows SessionEntry to the tool_call variant. */
export function isToolCallEntry(
	entry: SessionEntry
): entry is SessionEntryBase & { readonly type: "tool_call"; readonly message: ToolCall } {
	return entry.type === "tool_call";
}
