import {
	AGENT_PANEL_ACTION_IDS,
	type AgentPanelActionDescriptor,
	type AgentPanelActionId,
	type AgentPanelCardModel,
	type AgentPanelChromeModel,
	type AgentPanelComposerModel,
	type AgentPanelPlanSidebarItem,
	type AgentPanelSceneModel,
	type AgentPanelSceneEntryModel,
	type AgentPanelSessionStatus,
	type AgentPanelSidebarModel,
	type AgentPanelStripModel,
} from "@acepe/ui/agent-panel";

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { SessionStatus } from "../../../application/dto/session.js";
import { formatOtherToolName } from "../../../registry/index.js";
import type { FilePanel } from "../../../store/file-panel-type.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { ToolCall } from "../../../types/tool-call.js";
import type { ToolKind } from "../../../types/tool-kind.js";
import type { JsonValue } from "../../../../services/converted-session-types.js";
import type { ContentBlock, SessionPlanResponse } from "../../../../services/claude-history.js";
import { stripAnsiCodes } from "../../../utils/ansi-utils.js";
import { extractSkillCallInput } from "../../../utils/extract-skill-call-input.js";
import { parseToolResultWithExitCode } from "../../tool-calls/tool-call-execute/logic/parse-tool-result.js";
import { parseSearchResult } from "../../tool-calls/tool-call-search/logic/parse-grep-output.js";
import { parseWebSearchResult } from "../../tool-calls/tool-call-web-search/logic/parse-web-search-result.js";
import { resolveToolRouteKey } from "../../tool-calls/resolve-tool-operation.js";
import type { VirtualizedDisplayEntry } from "../logic/virtualized-entry-display.js";

export interface DesktopAgentPanelHeaderInput {
	title: string;
	subtitle?: string | null;
	agentLabel?: string | null;
	projectLabel?: string | null;
	projectColor?: string | null;
	branchLabel?: string | null;
	badges?: readonly { id: string; label: string; tone?: "neutral" | "info" | "success" | "warning" | "danger" }[];
	actions?: readonly AgentPanelActionDescriptor[];
}

export interface DesktopComposerInput {
	draftText: string;
	placeholder: string;
	submitLabel: string;
	canSubmit: boolean;
	disabledReason?: string | null;
	isWaitingForSession?: boolean;
	isStreaming?: boolean;
	selectedModelId?: string | null;
	selectedModelLabel?: string | null;
	selectedModelSubtitle?: string | null;
	projectLabel?: string | null;
	attachments?: readonly {
		id: string;
		label: string;
		kind: "file" | "folder" | "image" | "other";
		detail?: string | null;
	}[];
	showStop?: boolean;
}

export interface DesktopPrCardInput {
	description: string;
	filesChanged?: number | null;
	checksLabel?: string | null;
	isBusy?: boolean;
}

export interface DesktopWorktreeCardInput {
	description: string;
	stageLabel?: string | null;
	progressLabel?: string | null;
}

export interface DesktopInstallCardInput {
	description: string;
	stageLabel?: string | null;
	progressLabel?: string | null;
}

export interface DesktopErrorCardInput {
	title: string;
	description: string;
	details?: string | null;
}

export interface BuildDesktopAgentPanelSceneOptions {
	panelId: string;
	sessionStatus: SessionStatus | null | undefined;
	entries: readonly SessionEntry[];
	turnState?: TurnState;
	header: DesktopAgentPanelHeaderInput;
	composer?: DesktopComposerInput | null;
	modifiedFilesState?: ModifiedFilesState | null;
	plan?: SessionPlanResponse | null;
	showPlanSidebar?: boolean;
	attachedFilePanels?: readonly FilePanel[];
	activeAttachedFilePanelId?: string | null;
	prCard?: DesktopPrCardInput | null;
	worktreeCard?: DesktopWorktreeCardInput | null;
	installCard?: DesktopInstallCardInput | null;
	errorCard?: DesktopErrorCardInput | null;
	chrome?: AgentPanelChromeModel | null;
}

type AttachmentScopedBaseActionId =
	| typeof AGENT_PANEL_ACTION_IDS.attachment.selectTab
	| typeof AGENT_PANEL_ACTION_IDS.attachment.closeTab;

function createAttachmentScopedActionId(
	baseActionId: AttachmentScopedBaseActionId,
	value: string,
): AgentPanelActionId {
	const scopedActionId: `${AttachmentScopedBaseActionId}:${string}` = `${baseActionId}:${value}`;
	return scopedActionId;
}

function mapToolStatus(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean,
	isActiveToolCall: boolean
): "pending" | "running" | "done" | "error" {
	if (toolCall.status === "failed") {
		return "error";
	}

	if (toolCall.status === "completed") {
		return "done";
	}

	const hasResult = toolCall.result !== null && toolCall.result !== undefined;
	if (hasResult || parentCompleted) {
		return "done";
	}

	if (!isActiveToolCall || turnState !== "streaming") {
		return "done";
	}

	if (toolCall.status === "in_progress") {
		return "running";
	}

	return "pending";
}

function getActiveTailToolCallId(
	children: readonly ToolCall[] | null | undefined,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): string | null {
	if (!children || children.length === 0 || turnState !== "streaming" || parentCompleted) {
		return null;
	}

	const lastChild = children[children.length - 1];
	if (!lastChild) {
		return null;
	}

	if (lastChild.status === "completed" || lastChild.status === "failed") {
		return null;
	}

	if (lastChild.result !== null && lastChild.result !== undefined) {
		return null;
	}

	return lastChild.id;
}

function getActiveRootToolCallId(
	entries: readonly SessionEntry[],
	turnState: TurnState | undefined
): string | null {
	if (turnState !== "streaming" || entries.length === 0) {
		return null;
	}

	const lastEntry = entries[entries.length - 1];
	if (!lastEntry || lastEntry.type !== "tool_call") {
		return null;
	}

	const toolCall = lastEntry.message;
	if (toolCall.status === "completed" || toolCall.status === "failed") {
		return null;
	}

	if (toolCall.result !== null && toolCall.result !== undefined) {
		return null;
	}

	return toolCall.id;
}

function normalizeToolKind(kind: ToolKind | null | undefined) {
	if (!kind) {
		return "other";
	}

	if (kind === "glob") {
		return "search";
	}

	if (kind === "web_search") {
		return "web_search";
	}

	if (
		kind === "read" ||
		kind === "edit" ||
		kind === "delete" ||
		kind === "execute" ||
		kind === "search" ||
		kind === "fetch" ||
		kind === "think" ||
		kind === "skill" ||
		kind === "task" ||
		kind === "task_output" ||
		kind === "browser"
	) {
		return kind;
	}

	return "other";
}

function getDefaultToolTitle(kind: ToolKind, turnState: TurnState | undefined): string {
	if (kind === "execute") return "Run";
	if (kind === "read") return "Read";
	if (kind === "edit") return "Edit";
	if (kind === "delete") return "Delete";
	if (kind === "search" || kind === "glob") return "Search";
	if (kind === "fetch") return "Fetch";
	if (kind === "web_search") return "Web search";
	if (kind === "think") return "Thinking";
	if (kind === "task") return turnState === "streaming" ? "Task running" : "Task completed";
	if (kind === "task_output") return "Task output";
	if (kind === "todo") return turnState === "streaming" ? "Todo running" : "Todo completed";
	if (kind === "question") return turnState === "streaming" ? "Question running" : "Question completed";
	if (kind === "move") return "Move";
	if (kind === "skill") return "Skill";
	if (kind === "tool_search") return "Tool search";
	if (kind === "browser") return "Browser";
	if (kind === "enter_plan_mode") return "Enter plan mode";
	if (kind === "exit_plan_mode") return "Exit plan mode";
	if (kind === "create_plan") return "Create plan";
	return "Tool";
}

function resolveToolTitle(toolCall: ToolCall, kind: ToolKind, turnState: TurnState | undefined): string {
	const semanticTitle =
		kind === "other"
			? formatOtherToolName(toolCall.name)
			: (getDefaultToolTitle(kind, turnState) || toolCall.name);
	const rawTitle = toolCall.title?.trim();

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

function getToolSubtitle(toolCall: ToolCall): string | undefined {
	if (toolCall.arguments.kind === "execute") {
		return toolCall.arguments.command ?? undefined;
	}

	if (toolCall.arguments.kind === "search" || toolCall.arguments.kind === "webSearch") {
		return toolCall.arguments.query ?? undefined;
	}

	if (toolCall.arguments.kind === "fetch") {
		return toolCall.arguments.url ?? undefined;
	}

	if (toolCall.arguments.kind === "think") {
		return toolCall.arguments.description ?? undefined;
	}

	if (toolCall.arguments.kind === "other") {
		const raw = toolCall.arguments.raw;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			const intent = raw.intent;
			if (typeof intent === "string" && intent.trim().length > 0) {
				return intent.trim();
			}
		}
	}

	const firstTodo = toolCall.normalizedTodos?.find((todo) => todo.status === "in_progress");
	if (firstTodo) {
		return firstTodo.activeForm || firstTodo.content;
	}

	const firstQuestion = toolCall.normalizedQuestions?.[0];
	if (firstQuestion) {
		return firstQuestion.question;
	}

	return undefined;
}

function getToolFilePath(toolCall: ToolCall): string | undefined {
	if (toolCall.arguments.kind === "read") {
		return toolCall.arguments.file_path ?? undefined;
	}

	if (toolCall.arguments.kind === "search") {
		return toolCall.arguments.file_path ?? undefined;
	}

	if (toolCall.arguments.kind === "edit") {
		return toolCall.arguments.edits[0]?.filePath ?? toolCall.arguments.edits[0]?.moveFrom ?? undefined;
	}

	if (toolCall.arguments.kind === "delete") {
		return toolCall.arguments.file_path ?? toolCall.arguments.file_paths?.[0] ?? undefined;
	}

	if (toolCall.arguments.kind === "move") {
		return toolCall.arguments.to ?? toolCall.arguments.from ?? undefined;
	}

	return undefined;
}

function serializeOtherToolDetails(toolCall: ToolCall): string | null {
	if (toolCall.kind !== "other") {
		return null;
	}

	return JSON.stringify(
		{
			id: toolCall.id,
			name: toolCall.name,
			kind: toolCall.kind,
			title: toolCall.title,
			status: toolCall.status,
			arguments: toolCall.arguments,
			rawInput: toolCall.rawInput,
			result: toolCall.result,
			locations: toolCall.locations,
			skillMeta: toolCall.skillMeta,
			normalizedQuestions: toolCall.normalizedQuestions,
			normalizedTodos: toolCall.normalizedTodos,
			parentToolUseId: toolCall.parentToolUseId,
			questionAnswer: toolCall.questionAnswer,
			awaitingPlanApproval: toolCall.awaitingPlanApproval,
			planApprovalRequestId: toolCall.planApprovalRequestId,
		},
		null,
		2
	);
}

function mapQuestion(
	toolCall: ToolCall
):
	| {
			question: string;
			header?: string | null;
			options?: { label: string; description?: string | null }[] | null;
			multiSelect?: boolean;
	  }
	| null {
	const firstQuestion = toolCall.normalizedQuestions?.[0];
	if (!firstQuestion) {
		return null;
	}

	const options = firstQuestion.options.map((option) => {
		return {
			label: option.label,
			description: option.description ?? null,
		};
	});

	return {
		question: firstQuestion.question,
		header: firstQuestion.header,
		options,
		multiSelect: firstQuestion.multiSelect,
	};
}

function mapTodos(toolCall: ToolCall) {
	return toolCall.normalizedTodos?.map((todo) => {
		return {
			content: todo.content,
			activeForm: todo.activeForm,
			status: todo.status,
			duration: todo.duration ?? null,
		};
	});
}

function mapTaskChildren(
	children: readonly ToolCall[] | null | undefined,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AgentPanelSceneEntryModel[] | undefined {
	if (!children || children.length === 0) {
		return undefined;
	}

	const activeChildId = getActiveTailToolCallId(children, turnState, parentCompleted);
	return children.map((child) =>
		mapToolCallEntry(child, turnState, parentCompleted, activeChildId)
	);
}

function getToolResultObject(toolCall: ToolCall): Record<string, unknown> | null {
	const { result } = toolCall;
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		return null;
	}

	return result as Record<string, unknown>;
}

function mapSearchPayload(toolCall: ToolCall): {
	searchFiles?: string[];
	searchResultCount?: number;
} {
	if (toolCall.arguments.kind !== "search" && toolCall.arguments.kind !== "glob") {
		return {};
	}

	const resultObject = getToolResultObject(toolCall);
	const toolResponseMeta = resultObject
		? {
				mode: typeof resultObject.mode === "string" ? resultObject.mode : undefined,
				numFiles:
					typeof resultObject.numFiles === "number"
						? resultObject.numFiles
						: typeof resultObject.totalFiles === "number"
							? resultObject.totalFiles
							: undefined,
				numLines: typeof resultObject.numLines === "number" ? resultObject.numLines : undefined,
				filenames: Array.isArray(resultObject.filenames)
					? resultObject.filenames.filter((value): value is string => typeof value === "string")
					: undefined,
				content: typeof resultObject.content === "string" ? resultObject.content : undefined,
			}
		: undefined;
	const searchPath =
		toolCall.arguments.kind === "search"
			? (toolCall.arguments.file_path ?? undefined)
			: toolCall.arguments.pattern
				? (toolCall.arguments.path ?? undefined)
				: undefined;
	const parsedResult = parseSearchResult(toolCall.result, toolResponseMeta, searchPath);

	return {
		searchFiles: Array.from(parsedResult.files),
		searchResultCount:
			parsedResult.mode === "content"
				? (parsedResult.numMatches ?? parsedResult.numFiles)
				: parsedResult.files.length,
	};
}

function mapFetchResultText(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "fetch") {
		return null;
	}

	if (typeof toolCall.result === "string") {
		return toolCall.result;
	}

	if (toolCall.result === null || toolCall.result === undefined) {
		return null;
	}

	return JSON.stringify(toolCall.result, null, 2);
}

function mapWebSearchPayload(toolCall: ToolCall): {
	webSearchLinks?: {
		title: string;
		url: string;
		domain: string;
		pageAge?: string;
	}[];
	webSearchSummary?: string | null;
} {
	if (toolCall.arguments.kind !== "webSearch") {
		return {};
	}

	const parsedResult = parseWebSearchResult(toolCall.result as JsonValue | undefined | null);

	return {
		webSearchLinks: parsedResult.links.map((link) => ({
			title: link.title,
			url: link.url,
			domain: link.domain,
			pageAge: link.pageAge,
		})),
		webSearchSummary: parsedResult.summary,
	};
}

function mapLintDiagnostics(
	toolCall: ToolCall
):
	| {
			filePath?: string | null;
			line?: number | null;
			message?: string | null;
			severity?: string | null;
	  }[]
	| undefined {
	const resolvedKind = toolCall.kind ?? "other";
	if (resolveToolRouteKey(toolCall, resolvedKind) !== "read_lints") {
		return undefined;
	}

	const resultObject = getToolResultObject(toolCall);
	if (!resultObject || !Array.isArray(resultObject.diagnostics)) {
		return undefined;
	}

	return resultObject.diagnostics
		.filter((diagnostic): diagnostic is Record<string, unknown> => {
			return diagnostic !== null && typeof diagnostic === "object";
		})
		.map((diagnostic) => {
			return {
				filePath:
					typeof diagnostic.filePath === "string"
						? diagnostic.filePath
						: typeof diagnostic.file_path === "string"
							? diagnostic.file_path
							: null,
				line:
					typeof diagnostic.line === "number"
						? diagnostic.line
						: typeof diagnostic.lineNumber === "number"
							? diagnostic.lineNumber
							: null,
				message: typeof diagnostic.message === "string" ? diagnostic.message : null,
				severity: typeof diagnostic.severity === "string" ? diagnostic.severity : null,
			};
		});
}

function mapTaskDescription(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind === "think") {
		return toolCall.arguments.description ?? null;
	}

	if (toolCall.arguments.kind === "taskOutput") {
		return toolCall.arguments.task_id ? `Task: ${toolCall.arguments.task_id}` : null;
	}

	return null;
}

function mapTaskResultText(toolCall: ToolCall): string | null {
	if (toolCall.kind !== "task" && toolCall.kind !== "task_output") {
		return null;
	}

	return typeof toolCall.result === "string" ? toolCall.result : null;
}

function mapToolCallEntry(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean,
	activeToolCallId: string | null
): AgentPanelSceneEntryModel {
	const kind = toolCall.kind ?? "other";
	const parsedResult = kind === "execute" ? parseToolResultWithExitCode(toolCall.result) : null;
	const subtitle = getToolSubtitle(toolCall);
	const searchPayload = mapSearchPayload(toolCall);
	const webSearchPayload = mapWebSearchPayload(toolCall);
	const skillPayload = extractSkillCallInput(toolCall.arguments);
	const status = mapToolStatus(toolCall, turnState, parentCompleted, toolCall.id === activeToolCallId);

	return {
		id: toolCall.id,
		type: "tool_call",
		kind: normalizeToolKind(kind),
		title: resolveToolTitle(toolCall, kind, turnState),
		subtitle,
		detailsText: serializeOtherToolDetails(toolCall),
		filePath: getToolFilePath(toolCall),
		status,
		command: toolCall.arguments.kind === "execute" ? toolCall.arguments.command : null,
		stdout: parsedResult?.stdout ? stripAnsiCodes(parsedResult.stdout) : null,
		stderr: parsedResult?.stderr ? stripAnsiCodes(parsedResult.stderr) : null,
		exitCode: parsedResult?.exitCode,
		query:
			toolCall.arguments.kind === "search" || toolCall.arguments.kind === "webSearch"
				? toolCall.arguments.query ?? null
				: null,
		searchPath:
			toolCall.arguments.kind === "search" ? (toolCall.arguments.file_path ?? undefined) : undefined,
		searchFiles: searchPayload.searchFiles,
		searchResultCount: searchPayload.searchResultCount,
		url: toolCall.arguments.kind === "fetch" ? toolCall.arguments.url ?? null : null,
		resultText: mapFetchResultText(toolCall),
		webSearchLinks: webSearchPayload.webSearchLinks,
		webSearchSummary: webSearchPayload.webSearchSummary,
		skillName: skillPayload.skill,
		skillArgs: skillPayload.args,
		skillDescription: toolCall.skillMeta?.description ?? null,
		taskDescription: mapTaskDescription(toolCall),
		taskPrompt: toolCall.arguments.kind === "think" ? (toolCall.arguments.prompt ?? null) : null,
		taskResultText: mapTaskResultText(toolCall),
		taskChildren: mapTaskChildren(toolCall.taskChildren, turnState, status === "done"),
		todos: mapTodos(toolCall),
		question: mapQuestion(toolCall),
		lintDiagnostics: mapLintDiagnostics(toolCall),
	};
}

function contentBlockToPlainText(block: ContentBlock): string {
	if (block.type === "text") {
		return block.text;
	}

	if (block.type === "resource_link") {
		return block.title ?? block.name ?? block.uri;
	}

	if (block.type === "resource") {
		return block.resource.text ?? block.resource.uri;
	}

	if (block.type === "image") {
		return block.uri ?? "[Image]";
	}

	if (block.type === "audio") {
		return "[Audio]";
	}

	return "";
}

function contentBlocksToText(blocks: readonly ContentBlock[]): string {
	let text = "";

	for (const block of blocks) {
		text += contentBlockToPlainText(block);
	}

	return text.trim();
}

function extractAssistantMarkdown(entry: Extract<SessionEntry, { type: "assistant" }>): string {
	let text = "";

	for (const chunk of entry.message.chunks) {
		if (chunk.type !== "message") {
			continue;
		}

		text += contentBlockToPlainText(chunk.block);
	}

	return text.trim();
}

export function mapSessionStatusToSceneStatus(
	status: SessionStatus | null | undefined,
	entryCount: number
): AgentPanelSessionStatus {
	if (!status) {
		return "empty";
	}

	switch (status) {
		case "connecting":
			return "warming";
		case "idle":
			return entryCount > 0 ? "idle" : "empty";
		case "ready":
			return "connected";
		case "streaming":
			return "running";
		case "error":
			return "error";
		default:
			return "empty";
	}
}

export function mapSessionEntriesToConversationModel(
	entries: readonly SessionEntry[],
	turnState: TurnState | undefined
): { entries: readonly AgentPanelSceneEntryModel[]; isStreaming: boolean } {
	const activeRootToolCallId = getActiveRootToolCallId(entries, turnState);
	const conversationEntries = entries.map((entry) =>
		mapSessionEntryToConversationEntry(entry, turnState, activeRootToolCallId)
	);

	return {
		entries: conversationEntries,
		isStreaming: turnState === "streaming",
	};
}

export function mapSessionEntryToConversationEntry(
	entry: SessionEntry,
	turnState: TurnState | undefined,
	activeToolCallId: string | null = null
): AgentPanelSceneEntryModel {
	if (entry.type === "user") {
		return {
			id: entry.id,
			type: "user",
			text: contentBlocksToText(entry.message.chunks),
		};
	}

	if (entry.type === "assistant") {
		return {
			id: entry.id,
			type: "assistant",
			markdown: extractAssistantMarkdown(entry),
			isStreaming: entry.isStreaming,
		};
	}

	if (entry.type === "tool_call") {
		return mapToolCallEntry(entry.message, turnState, false, activeToolCallId);
	}

	if (entry.type === "ask") {
		return {
			id: entry.id,
			type: "tool_call",
			kind: "other",
			title: "Question",
			subtitle: entry.message.question,
			status: "running",
			question: {
				question: entry.message.question,
				header: entry.message.description ?? null,
				options: entry.message.options.map((option) => {
					return {
						label: option.label,
						description: option.description ?? null,
					};
				}),
				multiSelect: false,
			},
		};
	}

	return {
		id: entry.id,
		type: "tool_call",
		kind: "other",
		title: "Error",
		subtitle: entry.message.code,
		status: "error",
		resultText: entry.message.content,
	};
}

export function mapVirtualizedDisplayEntryToConversationEntry(
	entry: VirtualizedDisplayEntry,
	turnState: TurnState | undefined,
	isStreamingAssistant: boolean,
	activeToolCallId: string | null = null
): AgentPanelSceneEntryModel {
	if (entry.type === "thinking") {
		return {
			id: entry.id,
			type: "thinking",
		};
	}

	if (entry.type === "assistant_merged_thoughts") {
		return {
			id: entry.key,
			type: "assistant",
			markdown: contentBlocksToText(
				entry.message.chunks.map((chunk) => chunk.block)
			),
			isStreaming: isStreamingAssistant || entry.isStreaming,
		};
	}

	const mapped = mapSessionEntryToConversationEntry(entry, turnState, activeToolCallId);
	if (mapped.type === "assistant") {
		return {
			id: mapped.id,
			type: mapped.type,
			markdown: mapped.markdown,
			isStreaming: isStreamingAssistant,
		};
	}

	return mapped;
}

function derivePlanItems(plan: SessionPlanResponse): readonly AgentPanelPlanSidebarItem[] {
	const numberedItems: AgentPanelPlanSidebarItem[] = [];
	const checkboxItems: AgentPanelPlanSidebarItem[] = [];
	const lines = plan.content.split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
		if (numberedMatch) {
			numberedItems.push({
				id: `plan-numbered-${numberedItems.length + 1}`,
				label: numberedMatch[1] ?? line,
				status: "pending",
			});
			continue;
		}

		const checkboxMatch = line.match(/^- \[( |x|-)\]\s+(.+)$/i);
		if (!checkboxMatch) {
			continue;
		}

		let status: "pending" | "in_progress" | "done" | "blocked" = "pending";
		if ((checkboxMatch[1] ?? "").toLowerCase() === "x") {
			status = "done";
		}
		if ((checkboxMatch[1] ?? "") === "-") {
			status = "in_progress";
		}

		checkboxItems.push({
			id: `plan-checkbox-${checkboxItems.length + 1}`,
			label: checkboxMatch[2] ?? line,
			status,
		});
	}

	if (checkboxItems.length > 0) {
		return checkboxItems;
	}

	if (numberedItems.length > 0) {
		return numberedItems;
	}

	if (plan.summary) {
		return [
			{
				id: "plan-summary",
				label: plan.title,
				status: "in_progress",
				description: plan.summary,
			},
		];
	}

	return [];
}

export function buildDesktopPlanSidebar(
	plan: SessionPlanResponse | null | undefined,
	actions?: readonly AgentPanelActionDescriptor[]
) {
	if (!plan) {
		return null;
	}

	return {
		title: plan.title,
		items: derivePlanItems(plan),
		actions:
			actions ??
			[
				{
					id: AGENT_PANEL_ACTION_IDS.plan.openDialog,
					label: "Open plan",
					state: "enabled",
				},
			],
	};
}

export function buildDesktopAttachedFilesSidebar(
	panels: readonly FilePanel[] | undefined,
	activeFilePanelId: string | null | undefined
) {
	if (!panels || panels.length === 0) {
		return null;
	}

	const actions: AgentPanelActionDescriptor[] = [
	];

	return {
		tabs: panels.map((panel) => {
			const segments = panel.filePath.split("/");
			const title = segments[segments.length - 1] ?? panel.filePath;
			return {
				id: panel.id,
				title,
				path: panel.filePath,
				language: null,
				contentPreview: null,
				isActive: panel.id === activeFilePanelId,
				selectActionId: createAttachmentScopedActionId(
					AGENT_PANEL_ACTION_IDS.attachment.selectTab,
					panel.id
				),
				closeActionId: createAttachmentScopedActionId(
					AGENT_PANEL_ACTION_IDS.attachment.closeTab,
					panel.id
				),
			};
		}),
		actions,
	};
}

export function buildDesktopComposerModel(input: DesktopComposerInput): AgentPanelComposerModel {
	const attachments = input.attachments
		? input.attachments.map((attachment) => {
				return {
					id: attachment.id,
					label: attachment.label,
					kind: attachment.kind,
					detail: attachment.detail ?? null,
				};
			})
		: [];

	const actions: AgentPanelActionDescriptor[] = [
		{
			id: AGENT_PANEL_ACTION_IDS.composer.attachFile,
			label: "Attach",
			state: "enabled",
		},
		{
			id: AGENT_PANEL_ACTION_IDS.composer.selectModel,
			label: "Model",
			state: "enabled",
		},
		{
			id: input.showStop ? AGENT_PANEL_ACTION_IDS.composer.stop : AGENT_PANEL_ACTION_IDS.composer.submit,
			label: input.showStop ? "Stop" : input.submitLabel,
			state: input.canSubmit || input.showStop ? "enabled" : "disabled",
			disabledReason: input.disabledReason ?? null,
		},
	];

	return {
		draftText: input.draftText,
		placeholder: input.placeholder,
		submitLabel: input.submitLabel,
		canSubmit: input.canSubmit,
		disabledReason: input.disabledReason ?? null,
		isWaitingForSession: input.isWaitingForSession,
		isStreaming: input.isStreaming,
		selectedModel: input.selectedModelId
			? {
					id: input.selectedModelId,
					label: input.selectedModelLabel ?? input.selectedModelId,
					subtitle: input.selectedModelSubtitle ?? null,
					projectLabel: input.projectLabel ?? null,
				}
			: null,
		attachments,
		actions,
	};
}

export function buildModifiedFilesStrip(
	modifiedFilesState: ModifiedFilesState | null | undefined
): AgentPanelStripModel | null {
	if (!modifiedFilesState || modifiedFilesState.fileCount === 0) {
		return null;
	}

	return {
		id: "modified-files",
		kind: "modified_files",
		title: "Modified files",
		description: `${modifiedFilesState.fileCount} files changed`,
		items: [
			{
				id: "files",
				label: "Files",
				value: String(modifiedFilesState.fileCount),
			},
			{
				id: "edits",
				label: "Edits",
				value: String(modifiedFilesState.totalEditCount),
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.review.openFullscreen,
				label: "Review",
				state: "enabled",
			},
		],
	};
}

export function buildPlanHeaderStrip(
	plan: SessionPlanResponse | null | undefined,
	showPlanSidebar: boolean | undefined
): AgentPanelStripModel | null {
	if (!plan || showPlanSidebar) {
		return null;
	}

	return {
		id: "plan-header",
		kind: "plan_header",
		title: plan.title,
		description: plan.summary ?? null,
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.plan.toggleSidebar,
				label: "Open plan",
				state: "enabled",
			},
		],
	};
}

export function buildDesktopPrCard(input: DesktopPrCardInput | null | undefined): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "pr-status-card",
		kind: "pr_status",
		title: "Pull request",
		description: input.description,
		meta: [
			{
				id: "files-changed",
				label: "Files changed",
				value: input.filesChanged === null || input.filesChanged === undefined ? null : String(input.filesChanged),
			},
			{
				id: "checks",
				label: "Checks",
				value: input.checksLabel ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.review.openFullscreen,
				label: input.isBusy ? "Preparing" : "Open review",
				state: input.isBusy ? "busy" : "enabled",
			},
		],
	};
}

export function buildDesktopWorktreeCard(
	input: DesktopWorktreeCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "worktree-setup-card",
		kind: "worktree_setup",
		title: "Worktree setup",
		description: input.description,
		meta: [
			{
				id: "worktree-stage",
				label: "Stage",
				value: input.stageLabel ?? null,
			},
			{
				id: "worktree-progress",
				label: "Progress",
				value: input.progressLabel ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.worktree.create,
				label: "Creating",
				state: "busy",
			},
		],
	};
}

export function buildDesktopInstallCard(
	input: DesktopInstallCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "agent-install-card",
		kind: "install",
		title: "Agent install",
		description: input.description,
		meta: [
			{
				id: "install-stage",
				label: "Stage",
				value: input.stageLabel ?? null,
			},
			{
				id: "install-progress",
				label: "Progress",
				value: input.progressLabel ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.status.install,
				label: "Install",
				state: "busy",
			},
		],
	};
}

export function buildDesktopErrorCard(
	input: DesktopErrorCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "error-card",
		kind: "error",
		title: input.title,
		description: input.description,
		meta: [
			{
				id: "error-details",
				label: "Details",
				value: input.details ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.status.retry,
				label: "Retry",
				state: "enabled",
			},
			{
				id: AGENT_PANEL_ACTION_IDS.header.createIssueReport,
				label: "Report issue",
				state: "enabled",
			},
		],
	};
}

export function buildDesktopAgentPanelScene(
	options: BuildDesktopAgentPanelSceneOptions
): AgentPanelSceneModel {
	const status = mapSessionStatusToSceneStatus(options.sessionStatus, options.entries.length);
	const conversation = mapSessionEntriesToConversationModel(options.entries, options.turnState);
	const strips: AgentPanelStripModel[] = [];
	const cards: AgentPanelCardModel[] = [];

	const planHeader = buildPlanHeaderStrip(options.plan, options.showPlanSidebar);
	if (planHeader) {
		strips.push(planHeader);
	}

	const modifiedFilesStrip = buildModifiedFilesStrip(options.modifiedFilesState);
	if (modifiedFilesStrip) {
		strips.push(modifiedFilesStrip);
	}

	const prCard = buildDesktopPrCard(options.prCard);
	if (prCard) {
		cards.push(prCard);
	}

	const worktreeCard = buildDesktopWorktreeCard(options.worktreeCard);
	if (worktreeCard) {
		cards.push(worktreeCard);
	}

	const installCard = buildDesktopInstallCard(options.installCard);
	if (installCard) {
		cards.push(installCard);
	}

	const errorCard = buildDesktopErrorCard(options.errorCard);
	if (errorCard) {
		cards.push(errorCard);
	}

	const sidebars: AgentPanelSidebarModel = {
		plan: options.showPlanSidebar ? buildDesktopPlanSidebar(options.plan) : null,
		attachedFiles: buildDesktopAttachedFilesSidebar(
			options.attachedFilePanels,
			options.activeAttachedFilePanelId
		),
	};

	return {
		panelId: options.panelId,
		status,
		header: {
			title: options.header.title,
			subtitle: options.header.subtitle ?? null,
			status,
			agentLabel: options.header.agentLabel ?? null,
			projectLabel: options.header.projectLabel ?? null,
			projectColor: options.header.projectColor ?? null,
			branchLabel: options.header.branchLabel ?? null,
			badges: options.header.badges ?? [],
			actions:
				options.header.actions ??
				[
					{
						id: AGENT_PANEL_ACTION_IDS.header.copySessionMarkdown,
						label: "Copy",
						state: "enabled",
					},
				],
		},
		conversation,
		composer: options.composer ? buildDesktopComposerModel(options.composer) : null,
		strips,
		cards,
		sidebars,
		chrome: options.chrome ?? null,
	};
}
