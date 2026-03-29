import type { AgentToolEntry, AgentToolKind, AgentToolStatus } from "@acepe/ui/agent-panel";
import {
	getToolKindFilePath,
	getToolKindSubtitle,
	getToolKindTitle,
} from "../../../../registry/tool-kind-ui-registry.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import type { ToolKind } from "../../../../types/tool-kind.js";

/** Map ToolKind to AgentToolKind (presentational subset). */
const KIND_MAP: Record<ToolKind, AgentToolKind> = {
	read: "read",
	edit: "edit",
	execute: "execute",
	search: "search",
	glob: "search",
	fetch: "fetch",
	web_search: "web_search",
	think: "think",
	task: "task",
	task_output: "task_output",
	todo: "other",
	question: "other",
	skill: "other",
	move: "other",
	delete: "other",
	enter_plan_mode: "other",
	exit_plan_mode: "other",
	create_plan: "other",
	tool_search: "other",
	other: "other",
};

/** Map ToolCallStatus to AgentToolStatus. */
function mapStatus(status: string): AgentToolStatus {
	switch (status) {
		case "in_progress":
			return "running";
		case "completed":
			return "done";
		case "failed":
			return "error";
		default:
			return "pending";
	}
}

/** Convert a ToolCall child into an AgentToolEntry for display in the task card. */
function convertChild(child: ToolCall): AgentToolEntry {
	const kind = child.kind ?? "other";

	return {
		id: child.id,
		type: "tool_call",
		kind: KIND_MAP[kind] ?? "other",
		title: child.title ?? getToolKindTitle(kind, child) ?? child.name,
		subtitle: getToolKindSubtitle(kind, child) || undefined,
		filePath: getToolKindFilePath(kind, child) ?? undefined,
		status: mapStatus(child.status),
	};
}

/**
 * Convert taskChildren (ToolCall[]) into AnyAgentEntry[] for the AgentToolTask UI.
 */
export function convertTaskChildren(children: ToolCall[] | null | undefined): AgentToolEntry[] {
	if (!children || children.length === 0) return [];
	return children.map(convertChild);
}
