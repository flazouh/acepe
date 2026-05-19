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

/** Type guard: narrows SessionEntry to the user variant. */
export function isUserEntry(
	entry: SessionEntry
): entry is SessionEntryBase & { readonly type: "user"; readonly message: UserMessage } {
	return entry.type === "user";
}

/**
 * Canonical tool identity for a tool_call entry.
 *
 * The `message.id` field on this DTO is the tool_use id. It is not an
 * assistant provider message id and must not be used as display-row identity.
 */
export function toolCallIdFromEntry(
	entry: SessionEntryBase & { readonly type: "tool_call"; readonly message: ToolCall }
): string {
	return entry.message.id;
}

/**
 * Canonical user-message identity for a user entry, when one is present.
 *
 * This id comes from the canonical transcript entry, not from an assistant
 * provider container id.
 */
export function userMessageIdFromEntry(
	entry: SessionEntryBase & { readonly type: "user"; readonly message: UserMessage }
): string | undefined {
	return entry.message.id;
}
