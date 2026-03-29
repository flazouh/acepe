// Re-export ToolKind from generated Rust types
export type { ToolKind } from "../../services/converted-session-types.js";

/**
 * Tool kind constants for type-safe comparisons.
 */
export const TOOL_KINDS = {
	READ: "read",
	EDIT: "edit",
	EXECUTE: "execute",
	SEARCH: "search",
	GLOB: "glob",
	FETCH: "fetch",
	WEB_SEARCH: "web_search",
	THINK: "think",
	TODO: "todo",
	QUESTION: "question",
	TASK: "task",
	TASK_OUTPUT: "task_output",
	SKILL: "skill",
	MOVE: "move",
	DELETE: "delete",
	ENTER_PLAN_MODE: "enter_plan_mode",
	EXIT_PLAN_MODE: "exit_plan_mode",
	CREATE_PLAN: "create_plan",
	TOOL_SEARCH: "tool_search",
	OTHER: "other",
} as const;
