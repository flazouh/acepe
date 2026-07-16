import type {
	AgentPanelSceneEntryModel,
	AgentToolEntry,
	AgentToolPresentationState,
	AgentToolStatus,
} from "@acepe/ui/agent-panel/types";
import type { ToolCall } from "../../../../types/tool-call.js";
import type { TurnState } from "../../../../store/types.js";
import { stripAnsiCodes } from "../../../../utils/ansi-utils.js";
import { extractSkillCallInput } from "../../../../utils/extract-skill-call-input.js";
import { mapToolStatus } from "./tool-status.js";
import { normalizeToolKind, resolveToolTitle } from "./tool-title.js";
import { getToolFilePath, getToolSubtitle } from "./tool-subtitle.js";
import {
	getBrowserScriptHighlighter,
	getReadSourceExcerpt,
	getReadSourceHighlighter,
	getReadSourceRangeLabel,
} from "./tool-read-source.js";
import { serializeOtherToolDetails, serializeToolResult } from "./tool-result.js";
import { mapSearchPayload } from "./payloads/search-payload.js";
import { mapFetchResultText } from "./payloads/fetch-payload.js";
import { mapWebSearchPayload } from "./payloads/web-search-payload.js";
import { mapBrowserPayload } from "./payloads/browser-payload.js";
import { mapLintDiagnostics } from "./payloads/lint-payload.js";
import { mapTaskDescription, mapTaskResultText } from "./payloads/task-payload.js";
import { mapPlanPayload } from "./payloads/plan-payload.js";
import { mapQuestion } from "./payloads/question-payload.js";
import { mapTodos } from "./payloads/todos-payload.js";
import { mapEditDiffEntriesForToolCall } from "./payloads/edit-diff-payload.js";
import {
	getExecuteCommandHighlighter,
	getExecuteOutputHighlighter,
} from "./payloads/execute-command.js";

export interface MapToolCallEntryOptions {
	readonly displayEntryId?: string;
	readonly canonicalStatus?: AgentToolStatus;
	readonly presentationState?: AgentToolPresentationState;
	readonly degradedReason?: string | null;
	readonly taskChildren?: AgentPanelSceneEntryModel[];
	readonly includeDiagnosticDetails?: boolean;
}

function mapTaskChildren(
	children: readonly ToolCall[] | null | undefined,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AgentPanelSceneEntryModel[] | undefined {
	if (!children || children.length === 0) {
		return undefined;
	}

	return children.map((child) => mapToolCallEntry(child, turnState, parentCompleted));
}

function mapToolCallEntry(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean,
	options: MapToolCallEntryOptions = {}
): AgentPanelSceneEntryModel {
	const kind = toolCall.kind ?? "other";
	const executeResult =
		kind === "execute" && toolCall.normalizedResult?.kind === "execute"
			? toolCall.normalizedResult
			: null;
	const subtitle = getToolSubtitle(toolCall);
	const searchPayload = mapSearchPayload(toolCall);
	const webSearchPayload = mapWebSearchPayload(toolCall);
	const browserPayload = mapBrowserPayload(toolCall);
	const skillPayload = extractSkillCallInput(toolCall.arguments);
	const planPayload = mapPlanPayload(toolCall);
	const status =
		options.canonicalStatus ??
		mapToolStatus(toolCall, turnState, parentCompleted);
	const diagnosticDetails =
		options.includeDiagnosticDetails === false ? null : serializeOtherToolDetails(toolCall);
	const command = toolCall.arguments.kind === "execute" ? toolCall.arguments.command : null;
	const scriptText = kind === "browser" ? (browserPayload.scriptText ?? null) : undefined;
	const stdout = executeResult?.stdout ? stripAnsiCodes(executeResult.stdout) : null;
	const stderr = executeResult?.stderr ? stripAnsiCodes(executeResult.stderr) : null;

	const entry: AgentToolEntry = {
		id: options.displayEntryId ?? toolCall.id,
		type: "tool_call",
		toolCallId: toolCall.id,
		kind: normalizeToolKind(kind),
		title: resolveToolTitle(toolCall, kind, turnState),
		subtitle,
		detailsText:
			kind === "browser"
				? (browserPayload.detailsText ?? null)
				: kind === "sql"
					? serializeToolResult(
							toolCall.normalizedResult?.kind === "sql"
								? toolCall.normalizedResult.rawText
								: toolCall.result
						)
					: diagnosticDetails,
		scriptText,
		highlightScript: kind === "browser" ? getBrowserScriptHighlighter() : null,
		scriptHtml: null,
		filePath: getToolFilePath(toolCall),
		sourceExcerpt: getReadSourceExcerpt(toolCall),
		sourceExcerptHtml: null,
		highlightSource: getReadSourceHighlighter(toolCall),
		sourceRangeLabel: getReadSourceRangeLabel(toolCall),
		status,
		startedAtMs: toolCall.startedAtMs ?? null,
		completedAtMs: toolCall.completedAtMs ?? null,
		command,
		commandHtmls: undefined,
		highlightCommand: command ? getExecuteCommandHighlighter() : null,
		highlightOutput: kind === "execute" ? getExecuteOutputHighlighter() : null,
		stdout,
		stderr,
		stdoutHtml: null,
		stderrHtml: null,
		exitCode: executeResult?.exitCode,
		query:
			toolCall.arguments.kind === "search" || toolCall.arguments.kind === "webSearch"
				? (toolCall.arguments.query ?? null)
				: null,
		searchPath:
			toolCall.arguments.kind === "search"
				? (toolCall.arguments.file_path ?? undefined)
				: undefined,
		searchFiles: searchPayload.searchFiles,
		searchResultCount: searchPayload.searchResultCount,
		searchMode: searchPayload.searchMode,
		searchNumFiles: searchPayload.searchNumFiles,
		searchNumMatches: searchPayload.searchNumMatches,
		searchMatches: searchPayload.searchMatches,
		url: toolCall.arguments.kind === "fetch" ? (toolCall.arguments.url ?? null) : null,
		resultText: mapFetchResultText(toolCall),
		webSearchLinks: webSearchPayload.webSearchLinks,
		webSearchSummary: webSearchPayload.webSearchSummary,
		skillName: skillPayload.skill,
		skillArgs: skillPayload.args,
		skillDescription: toolCall.skillMeta?.description ?? null,
		taskDescription: mapTaskDescription(toolCall),
		taskPrompt: toolCall.arguments.kind === "think" ? (toolCall.arguments.prompt ?? null) : null,
		taskResultText: mapTaskResultText(toolCall),
		taskChildren:
			options.taskChildren !== undefined
				? Array.from(options.taskChildren)
				: mapTaskChildren(toolCall.taskChildren, turnState, status === "done"),
		todos: mapTodos(toolCall),
		question: mapQuestion(toolCall),
		lintDiagnostics: mapLintDiagnostics(toolCall),
		planTitle: planPayload.planTitle,
		planContent: planPayload.planContent,
		planStatus: planPayload.planStatus,
	};

	if (normalizeToolKind(kind) === "edit") {
		entry.editDiffs = mapEditDiffEntriesForToolCall(toolCall);
	}

	if (options.presentationState !== undefined) {
		entry.presentationState = options.presentationState;
	}
	if (options.degradedReason !== undefined) {
		entry.degradedReason = options.degradedReason;
	}

	return entry;
}

export function mapToolCallToSceneEntry(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean = false,
	options: MapToolCallEntryOptions = {}
): AgentPanelSceneEntryModel {
	return mapToolCallEntry(toolCall, turnState, parentCompleted, options);
}
