import type {
	JsonValue,
	StoredErrorMessage,
	StoredAssistantMessage,
	StoredEntry,
	StoredUserMessage,
	ToolCallData,
	ToolArguments,
	ToolKind,
} from "$lib/services/converted-session-types.js";
import type { SessionEntry } from "../application/dto/session.js";
import type { AssistantMessage } from "../types/assistant-message.js";
import type { ErrorMessage } from "../types/error-message.js";
import type { ToolCall } from "../types/tool-call.js";
import type { UserMessage } from "../types/user-message.js";
import { reclassifyGenericToolCall } from "../utils/reclassify-generic-tool-call.js";

const LEGACY_TOOL_NAME_LABELS: Record<string, string> = {
	Bash: "Run",
	Execute: "Run",
	Glob: "Find",
	Grep: "Search",
	WebSearch: "Web Search",
	TaskOutput: "Task Output",
	EnterPlanMode: "Plan",
	ExitPlanMode: "Plan",
	CreatePlan: "Create Plan",
	read_file: "Read",
	ReadFile: "Read",
	edit_file: "Edit",
	EditFile: "Edit",
	apply_patch: "Edit",
};

function canonicalToolName(name: string): string {
	const label = LEGACY_TOOL_NAME_LABELS[name];
	return label ? label : name;
}

/**
 * Convert ToolCallData (backend) to ToolCall (frontend).
 *
 * ToolCall extends ToolCallData with optional timing fields.
 * Since StoredEntry now uses the same ToolCallData type as live streaming,
 * this is a direct pass-through with recursive task children conversion.
 */
function convertToolCallData(data: ToolCallData): ToolCall {
	const taskChildren = data.taskChildren ? data.taskChildren.map(convertToolCallData) : undefined;
	const reclassified = reclassifyGenericToolCall(data);

	return {
		id: data.id,
		name: reclassified ? reclassified.name : canonicalToolName(data.name),
		arguments: reclassified ? reclassified.arguments : data.arguments,
		rawInput: data.rawInput,
		status: data.status,
		result: data.result,
		kind: reclassified ? reclassified.kind : data.kind,
		title: data.title,
		locations: data.locations,
		skillMeta: data.skillMeta,
		normalizedQuestions: data.normalizedQuestions,
		normalizedTodos: data.normalizedTodos,
		parentToolUseId: data.parentToolUseId,
		taskChildren,
		questionAnswer: data.questionAnswer,
		awaitingPlanApproval: data.awaitingPlanApproval,
		planApprovalRequestId: data.planApprovalRequestId,
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

function convertStoredErrorMessage(stored: StoredErrorMessage): ErrorMessage {
	return {
		content: stored.content,
		code: stored.code ?? undefined,
		kind: stored.kind,
	};
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
		case "error":
			return {
				id: entry.id,
				type: "error",
				message: convertStoredErrorMessage(entry.message),
				timestamp,
			};
		default: {
			const _exhaustive: never = entry;
			throw new Error(`Unknown entry type: ${JSON.stringify(_exhaustive)}`);
		}
	}
}
