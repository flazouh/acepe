import type {
	StoredAssistantMessage,
	StoredEntry,
	StoredUserMessage,
	ToolCallData,
} from "$lib/services/converted-session-types.js";
import type { SessionEntry } from "../application/dto/session.js";
import type { AssistantMessage } from "../types/assistant-message.js";
import type { ToolCall } from "../types/tool-call.js";
import type { UserMessage } from "../types/user-message.js";

/**
 * Convert ToolCallData (backend) to ToolCall (frontend).
 *
 * ToolCall extends ToolCallData with optional timing fields.
 * Since StoredEntry now uses the same ToolCallData type as live streaming,
 * this is a direct pass-through with recursive task children conversion.
 */
function convertToolCallData(data: ToolCallData): ToolCall {
	return {
		...data,
		taskChildren: data.taskChildren?.map(convertToolCallData) ?? undefined,
	};
}

/**
 * Convert StoredUserMessage (backend) to UserMessage (frontend).
 */
function convertStoredUserMessage(stored: StoredUserMessage): UserMessage {
	return stored as unknown as UserMessage;
}

/**
 * Convert StoredAssistantMessage (backend) to AssistantMessage (frontend).
 */
function convertStoredAssistantMessage(stored: StoredAssistantMessage): AssistantMessage {
	return stored as unknown as AssistantMessage;
}

/**
 * Convert StoredEntry (backend) to SessionEntry (frontend).
 *
 * Handles discriminated union with exhaustiveness checking.
 */
export function convertStoredEntryToSessionEntry(
	entry: StoredEntry,
	timestamp: Date
): SessionEntry {
	switch (entry.type) {
		case "tool_call":
			return {
				id: entry.id,
				type: "tool_call",
				message: convertToolCallData(entry.message),
				timestamp,
			};
		case "user":
			return {
				id: entry.id,
				type: "user",
				message: convertStoredUserMessage(entry.message),
				timestamp,
			};
		case "assistant":
			return {
				id: entry.id,
				type: "assistant",
				message: convertStoredAssistantMessage(entry.message),
				timestamp,
			};
		default: {
			const _exhaustive: never = entry;
			throw new Error(`Unknown entry type: ${JSON.stringify(_exhaustive)}`);
		}
	}
}
