import { formatOtherToolName } from "../../../../registry/index.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import type { ToolKind } from "../../../../types/tool-kind.js";
import type { TurnState } from "../../../../store/types.js";

export function normalizeToolKind(kind: ToolKind | null | undefined) {
	if (!kind) {
		return "other";
	}

	if (kind === "glob") {
		return "search";
	}

	if (kind === "web_search") {
		return "web_search";
	}

	if (kind === "shell_input") {
		return "execute";
	}

	if (
		kind === "read" ||
		kind === "read_lints" ||
		kind === "edit" ||
		kind === "delete" ||
		kind === "execute" ||
		kind === "search" ||
		kind === "fetch" ||
		kind === "think" ||
		kind === "skill" ||
		kind === "task" ||
		kind === "task_output" ||
		kind === "enter_plan_mode" ||
		kind === "exit_plan_mode" ||
		kind === "create_plan" ||
		kind === "browser"
	) {
		return kind;
	}

	return "other";
}

export function getDefaultToolTitle(kind: ToolKind, turnState: TurnState | undefined): string {
	if (kind === "execute") return "Run";
	if (kind === "shell_input") return "Shell input";
	if (kind === "read") return "Read";
	if (kind === "read_lints") return "Read lints";
	if (kind === "edit") return "Edit";
	if (kind === "delete") return "Delete";
	if (kind === "search" || kind === "glob") return "Search";
	if (kind === "fetch") return "Fetch";
	if (kind === "web_search") return "Web search";
	if (kind === "think") return "Thinking";
	if (kind === "task") return turnState === "streaming" ? "Task running" : "Task completed";
	if (kind === "task_output") return "Task output";
	if (kind === "todo") return turnState === "streaming" ? "Todo running" : "Todo completed";
	if (kind === "question")
		return turnState === "streaming" ? "Question running" : "Question completed";
	if (kind === "move") return "Move";
	if (kind === "skill") return "Skill";
	if (kind === "tool_search") return "Tool search";
	if (kind === "browser") return "Browser";
	if (kind === "sql") return "SQL";
	if (kind === "unclassified") return "Tool";
	if (kind === "enter_plan_mode") return "Enter plan mode";
	if (kind === "exit_plan_mode") return "Plan ready";
	if (kind === "create_plan") return "Create plan";
	return "Tool";
}

export function resolveToolTitle(
	toolCall: ToolCall,
	kind: ToolKind,
	turnState: TurnState | undefined
): string {
	const semanticTitle =
		kind === "other" || kind === "unclassified"
			? formatOtherToolName(toolCall.name)
			: getDefaultToolTitle(kind, turnState) || toolCall.name;
	const rawTitle = toolCall.title?.trim();

	if (!rawTitle) {
		return semanticTitle;
	}

	if (kind === "exit_plan_mode" || kind === "create_plan") {
		return semanticTitle;
	}

	if (
		(kind === "delete" &&
			rawTitle.localeCompare("apply_patch", undefined, { sensitivity: "accent" }) === 0) ||
		kind === "skill"
	) {
		return semanticTitle;
	}

	return rawTitle;
}
