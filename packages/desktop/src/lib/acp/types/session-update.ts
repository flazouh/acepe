// Re-export types from generated Rust types (via specta)
// These types are now defined in Rust and generated via specta
export type {
	AvailableCommandsData,
	ConfigOptionUpdateData,
	ContentChunk,
	CurrentModeData,
	PermissionData,
	PlanData,
	QuestionData,
	SessionUpdate,
	ToolCallData,
	ToolCallUpdateData,
} from "../../services/converted-session-types.js";

// Re-export legacy types for backward compatibility
export type { ToolCall, ToolCallUpdate } from "./tool-call.js";

/**
 * Available commands update.
 *
 * Represents an update to available commands in a session.
 * @deprecated Use AvailableCommandsData from converted-session-types.ts
 */
export type AvailableCommandsUpdate = {
	/**
	 * List of available commands with full metadata.
	 */
	availableCommands: import("../../services/converted-session-types.js").AvailableCommand[];
};

/**
 * Current mode update.
 *
 * Represents an update to the current mode in a session.
 * @deprecated Use CurrentModeData from converted-session-types.ts
 */
export type CurrentModeUpdate = {
	/**
	 * The new current mode ID.
	 */
	currentModeId: string;
};
