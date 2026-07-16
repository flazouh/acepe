import type { HugeiconsIconName } from "../icons/hugeicons-icon-registry.js";
import type { AgentToolKind } from "./types.js";

/** Product icon name for each tool kind. Every value must exist in the Hugeicons registry. */
export const toolKindIconNameByKind: Record<AgentToolKind, HugeiconsIconName> = {
	read: "tool-read",
	read_lints: "tool-task",
	review: "tool-edit",
	edit: "tool-edit",
	delete: "trash",
	write: "tool-edit",
	execute: "terminal",
	search: "tool-search",
	fetch: "tool-web",
	web_search: "tool-web",
	think: "tool-think",
	skill: "tool-skill",
	task: "tool-task",
	task_output: "tool-task",
	enter_plan_mode: "tool-plan",
	exit_plan_mode: "tool-plan",
	create_plan: "tool-plan",
	browser: "tool-browser",
	sql: "tool-sql",
	unclassified: "question",
	other: "question",
};

export const toolKindIconNames = Object.freeze(
	Object.values(toolKindIconNameByKind),
) as readonly HugeiconsIconName[];
