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
	ToolCallUpdateData as _ToolCallUpdateData,
} from "../../services/converted-session-types.js";

interface ToolCallTiming {
	startedAtMs?: number;
	completedAtMs?: number;
}

// Legacy aliases for backward compatibility
export type ToolCallUpdate = _ToolCallUpdateData;
export type ToolCall = _ToolCallData & ToolCallTiming;
export type ToolCallData = _ToolCallData;
export type ToolCallUpdateData = _ToolCallUpdateData;
