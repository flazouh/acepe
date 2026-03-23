// Re-export ToolKind from generated Rust types
import type { ToolKind } from "../../services/converted-session-types.js";

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
	SKILL: "skill",
	MOVE: "move",
	DELETE: "delete",
	ENTER_PLAN_MODE: "enter_plan_mode",
	EXIT_PLAN_MODE: "exit_plan_mode",
	CREATE_PLAN: "create_plan",
	OTHER: "other",
} as const;

/**
 * Human-readable display labels for each tool kind.
 */
export const TOOL_KIND_LABELS: Record<ToolKind, string> = {
	read: "Read",
	edit: "Edit",
	execute: "Run",
	search: "Search",
	glob: "Find",
	fetch: "Fetch",
	web_search: "Web Search",
	think: "Think",
	todo: "Todo",
	question: "Question",
	task: "Task",
	skill: "Skill",
	move: "Move",
	delete: "Delete",
	enter_plan_mode: "Plan",
	exit_plan_mode: "Plan",
	create_plan: "Create Plan",
	other: "Tool",
};
