// Re-export tool call types from generated Rust types (via specta)
// These types are now defined in Rust and generated via specta
export type {
	QuestionAnswer,
	SkillMeta,
	ToolCallLocation,
	ToolCallStatus,
} from "../../services/converted-session-types.js";

// Import the data types directly to avoid circular dependencies
import type {
	ToolCallData as _ToolCallData,
	ToolArguments,
} from "../../services/converted-session-types.js";
import type { NormalizedToolResult } from "./normalized-tool-result.js";

interface ToolCallTiming {
	startedAtMs?: number;
	completedAtMs?: number;
}

export type ToolPresentationStatus =
	| "pending"
	| "running"
	| "done"
	| "error"
	| "blocked"
	| "cancelled"
	| "degraded";

export interface ToolCall extends _ToolCallData, ToolCallTiming {
	progressiveArguments?: ToolArguments;
	normalizedResult?: NormalizedToolResult | null;
	taskChildren?: ToolCall[] | null;
	presentationStatus?: ToolPresentationStatus;
}
