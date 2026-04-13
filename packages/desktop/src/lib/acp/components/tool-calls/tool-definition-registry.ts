import type { AgentToolEntry, AgentToolStatus } from "@acepe/ui/agent-panel";
import type { Component } from "svelte";
import {
	getToolKindFilePath,
	getToolKindSubtitle,
	getToolKindTitle,
} from "../../registry/tool-kind-ui-registry.js";
import type { TurnState } from "../../store/types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { resolveToolRouteKey, type ToolRouteKey } from "./resolve-tool-operation.js";
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
import { toAgentToolKind } from "./tool-kind-to-agent-tool-kind.js";

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

function mapAgentToolStatus(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AgentToolStatus {
	if (toolCall.status === "failed") {
		return "error";
	}

	if (toolCall.status === "completed") {
		return "done";
	}

	const hasResult = toolCall.result !== null && toolCall.result !== undefined;
	if (hasResult) {
		return "done";
	}

	if (parentCompleted) {
		return "done";
	}

	if (toolCall.status === "in_progress" && turnState === "streaming") {
		return "running";
	}

	if (toolCall.status === "in_progress" && turnState !== undefined && turnState !== "streaming") {
		return "done";
	}

	return "pending";
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

function resolveToolEntryTitle(options: ToolDisplayOptions, kind: ToolKind): string {
	const semanticTitle =
		getToolKindTitle(kind, options.toolCall, options.turnState) ?? options.toolCall.name;
	const rawTitle = options.toolCall.title?.trim();

	if (!rawTitle) {
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

function buildQuestionPayload(toolCall: ToolCall): AgentToolEntry["question"] {
	const firstQuestion = toolCall.normalizedQuestions?.[0];
	if (!firstQuestion) {
		return null;
	}

	return {
		question: firstQuestion.question,
		header: firstQuestion.header,
		options: firstQuestion.options.map((option) => ({
			label: option.label,
			description: option.description ?? null,
		})),
		multiSelect: firstQuestion.multiSelect,
	};
}

function buildTodosPayload(toolCall: ToolCall): AgentToolEntry["todos"] {
	return toolCall.normalizedTodos?.map((todo) => ({
		content: todo.content,
		activeForm: todo.activeForm,
		status: todo.status,
		duration: todo.duration ?? null,
	}));
}

function buildDefaultFullEntry(options: ToolDisplayOptions): AgentToolEntry {
	const kind = options.toolKind ?? options.toolCall.kind ?? "other";
	const question = buildQuestionPayload(options.toolCall);
	const todos = buildTodosPayload(options.toolCall);

	const entry: AgentToolEntry = {
		id: options.toolCall.id,
		type: "tool_call",
		kind: toAgentToolKind(kind),
		title: resolveToolEntryTitle(options, kind),
		subtitle: getToolKindSubtitle(kind, options.toolCall) || undefined,
		filePath: getToolKindFilePath(kind, options.toolCall) ?? undefined,
		status: mapAgentToolStatus(
			options.toolCall,
			options.turnState,
			options.parentCompleted === true
		),
	};

	if (question !== null) {
		entry.question = question;
	}

	if (todos !== undefined) {
		entry.todos = todos;
	}

	return entry;
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
	const resolvedKind = toolKind ?? toolCall.kind ?? "other";
	const routeKey = resolveToolRouteKey(toolCall, resolvedKind);
	return TOOL_DEFINITIONS[routeKey] ?? FALLBACK_TOOL_DEFINITION;
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
