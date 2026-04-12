import type { AgentToolEntry, AgentToolStatus } from "@acepe/ui/agent-panel";
import type { Component } from "svelte";
import type { TurnState } from "../../store/types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { buildToolPresentation, type ToolRouteKey } from "./tool-presentation.js";
import ToolCallBrowser from "./tool-call-browser.svelte";
import ToolCallCreatePlan from "./tool-call-create-plan.svelte";
import ToolCallDelete from "./tool-call-delete.svelte";
import ToolCallEdit from "./tool-call-edit.svelte";
import ToolCallEnterPlanMode from "./tool-call-enter-plan-mode.svelte";
import { parseToolResultWithExitCode } from "./tool-call-execute/logic/parse-tool-result.js";
import ToolCallExecute from "./tool-call-execute.svelte";
import ToolCallExitPlanMode from "./tool-call-exit-plan-mode.svelte";
import ToolCallFallback from "./tool-call-fallback.svelte";
import ToolCallFetch from "./tool-call-fetch.svelte";
import ToolCallQuestion from "./tool-call-question.svelte";
import ToolCallRead from "./tool-call-read.svelte";
import ToolCallReadLints from "./tool-call-read-lints.svelte";
import ToolCallSearch from "./tool-call-search.svelte";
import ToolCallSkill from "./tool-call-skill.svelte";
import ToolCallTask from "./tool-call-task.svelte";
import ToolCallTaskOutput from "./tool-call-task-output.svelte";
import ToolCallThink from "./tool-call-think.svelte";
import ToolCallTodo from "./tool-call-todo.svelte";
import ToolCallToolSearch from "./tool-call-tool-search.svelte";
import ToolCallWebSearch from "./tool-call-web-search.svelte";
export type ToolDetailComponentProps = {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
	pendingPermission?: PermissionRequest | null;
};

interface ToolDisplayOptions {
	toolCall: ToolCall;
	toolKind?: ToolKind | null;
	turnState?: TurnState;
	parentCompleted?: boolean;
}

export type CompactToolDisplay = Pick<
	AgentToolEntry,
	"id" | "kind" | "title" | "filePath" | "status"
>;

export interface ToolDefinition {
	rendererKey: ToolRouteKey;
	component: Component<ToolDetailComponentProps>;
	buildFullEntry: (options: ToolDisplayOptions) => AgentToolEntry;
	buildCompactEntry: (options: ToolDisplayOptions) => CompactToolDisplay;
}

function compactToolEntry(entry: AgentToolEntry): CompactToolDisplay {
	return {
		id: entry.id,
		kind: entry.kind,
		title: entry.filePath ? entry.title : (entry.subtitle ?? entry.title),
		filePath: entry.filePath,
		status: entry.status,
	};
}

function buildDefaultFullEntry(options: ToolDisplayOptions): AgentToolEntry {
	const presentation = buildToolPresentation({
		toolCall: options.toolCall,
		toolKind: options.toolKind,
		turnState: options.turnState,
		parentCompleted: options.parentCompleted,
	});

	return {
		id: options.toolCall.id,
		type: "tool_call",
		kind: presentation.agentKind,
		title: presentation.title,
		subtitle: presentation.subtitle,
		filePath: presentation.filePath,
		status: presentation.agentStatus,
	};
}

function createToolDefinition(
	rendererKey: ToolRouteKey,
	component: Component<ToolDetailComponentProps>
): ToolDefinition {
	return {
		rendererKey,
		component,
		buildFullEntry: buildDefaultFullEntry,
		buildCompactEntry: (options) => compactToolEntry(buildDefaultFullEntry(options)),
	};
}

function buildExecuteFullEntry(options: ToolDisplayOptions): AgentToolEntry {
	const baseEntry = buildDefaultFullEntry(options);
	const parsedResult = parseToolResultWithExitCode(options.toolCall.result);
	const command =
		options.toolCall.arguments.kind === "execute"
			? options.toolCall.arguments.command
			: (baseEntry.subtitle ?? null);

	return {
		id: baseEntry.id,
		type: baseEntry.type,
		kind: baseEntry.kind,
		title: baseEntry.title,
		subtitle: baseEntry.subtitle,
		filePath: baseEntry.filePath,
		status: baseEntry.status,
		command,
		stdout: parsedResult.stdout,
		stderr: parsedResult.stderr,
		exitCode: parsedResult.exitCode,
	};
}

const TOOL_DEFINITIONS: Partial<Record<ToolRouteKey, ToolDefinition>> = {
	read: createToolDefinition("read", ToolCallRead),
	read_lints: createToolDefinition("read_lints", ToolCallReadLints),
	edit: createToolDefinition("edit", ToolCallEdit),
	execute: {
		rendererKey: "execute",
		component: ToolCallExecute,
		buildFullEntry: buildExecuteFullEntry,
		buildCompactEntry: (options) => compactToolEntry(buildExecuteFullEntry(options)),
	},
	search: createToolDefinition("search", ToolCallSearch),
	glob: createToolDefinition("glob", ToolCallSearch),
	fetch: createToolDefinition("fetch", ToolCallFetch),
	web_search: createToolDefinition("web_search", ToolCallWebSearch),
	enter_plan_mode: createToolDefinition("enter_plan_mode", ToolCallEnterPlanMode),
	exit_plan_mode: createToolDefinition("exit_plan_mode", ToolCallExitPlanMode),
	create_plan: createToolDefinition("create_plan", ToolCallCreatePlan),
	delete: createToolDefinition("delete", ToolCallDelete),
	think: createToolDefinition("think", ToolCallThink),
	todo: createToolDefinition("todo", ToolCallTodo),
	question: createToolDefinition("question", ToolCallQuestion),
	task: createToolDefinition("task", ToolCallTask),
	task_output: createToolDefinition("task_output", ToolCallTaskOutput),
	skill: createToolDefinition("skill", ToolCallSkill),
	tool_search: createToolDefinition("tool_search", ToolCallToolSearch),
	browser: createToolDefinition("browser", ToolCallBrowser),
	other: createToolDefinition("other", ToolCallFallback),
};

const FALLBACK_TOOL_DEFINITION = createToolDefinition("other", ToolCallFallback);

export function getToolDefinition(toolCall: ToolCall, toolKind?: ToolKind | null): ToolDefinition {
	const presentation = buildToolPresentation({ toolCall, toolKind });
	return TOOL_DEFINITIONS[presentation.routeKey] ?? FALLBACK_TOOL_DEFINITION;
}

export function resolveFullToolEntry(options: ToolDisplayOptions): AgentToolEntry {
	return getToolDefinition(options.toolCall, options.toolKind).buildFullEntry(options);
}

export function resolveCompactToolDisplay(options: ToolDisplayOptions): CompactToolDisplay {
	return getToolDefinition(options.toolCall, options.toolKind).buildCompactEntry(options);
}

export function compactAgentToolEntry(entry: AgentToolEntry): CompactToolDisplay {
	return compactToolEntry(entry);
}
