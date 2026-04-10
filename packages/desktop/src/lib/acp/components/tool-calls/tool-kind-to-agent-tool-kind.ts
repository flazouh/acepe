import type { AgentToolKind } from "@acepe/ui/agent-panel";

import type { ToolKind } from "$lib/acp/types/tool-kind.js";

const TOOL_KIND_TO_AGENT_TOOL_KIND: Record<ToolKind, AgentToolKind> = {
	read: "read",
	edit: "edit",
	delete: "delete",
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
	enter_plan_mode: "other",
	exit_plan_mode: "other",
	create_plan: "other",
	tool_search: "other",
	other: "other",
};

export function toAgentToolKind(kind: ToolKind): AgentToolKind;
export function toAgentToolKind(kind: ToolKind | null | undefined): AgentToolKind | undefined;
export function toAgentToolKind(kind: ToolKind | null | undefined): AgentToolKind | undefined {
	if (kind === null || kind === undefined) {
		return undefined;
	}

	return TOOL_KIND_TO_AGENT_TOOL_KIND[kind];
}
