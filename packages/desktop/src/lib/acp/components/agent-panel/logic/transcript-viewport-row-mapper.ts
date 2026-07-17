import type {
	AgentToolEditDiffEntry,
	AgentToolKind,
	AgentPanelSceneEntryModel,
	AgentTaskLatestAction,
	AgentToolStatus,
} from "@acepe/ui/agent-panel";
import type {
	EditEntry,
	JsonValue,
	OperationSnapshot,
	SessionCompactionEvent,
	OperationState,
	TranscriptSegment,
	TranscriptViewportOperationDisplayFacts,
	TranscriptViewportOperationLink,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";
import { formatOtherToolName } from "../../../registry/index.js";
import { buildUserRowSceneModel } from "../../../logic/user-row-scene-model.js";
import { transcriptSegmentPrimaryText } from "../../../session-state/transcript-text.js";
import { calculateDiffStats, getFileName } from "../../../utils/file-utils.js";
import {
	getExecuteCommandHighlighter,
	getExecuteOutputHighlighter,
} from "../scene/tool/payloads/execute-command.js";
import { getBrowserScriptHighlighter } from "../scene/tool/tool-read-source.js";

export function segmentText(segments: readonly TranscriptSegment[]): string {
	let text = "";
	for (const segment of segments) {
		text += transcriptSegmentPrimaryText(segment);
	}
	return text;
}

export function toolStatusFromOperationState(state: OperationState): AgentToolStatus {
	if (state === "running") {
		return "running";
	}
	if (state === "completed") {
		return "done";
	}
	if (state === "failed") {
		return "error";
	}
	if (state === "blocked") {
		return "blocked";
	}
	if (state === "cancelled") {
		return "cancelled";
	}
	if (state === "degraded") {
		return "degraded";
	}
	return "pending";
}

function withViewportPlanningTiming(
	entry: AgentPanelSceneEntryModel,
	row: TranscriptViewportRow
): AgentPanelSceneEntryModel {
	const durationStartedAtMs = row.durationStartedAtMs;
	if (durationStartedAtMs === null || durationStartedAtMs === undefined) {
		return entry;
	}

	if (entry.type === "thinking") {
		if (entry.startedAtMs !== null && entry.startedAtMs !== undefined) {
			return entry;
		}
		return {
			id: entry.id,
			type: entry.type,
			durationMs: entry.durationMs ?? null,
			startedAtMs: durationStartedAtMs,
			label: entry.label,
		};
	}

	if (entry.type === "assistant") {
		if (entry.planningStartedAtMs !== null && entry.planningStartedAtMs !== undefined) {
			return entry;
		}
		if (entry.isStreaming !== true) {
			return entry;
		}
		return {
			id: entry.id,
			type: entry.type,
			markdown: entry.markdown,
			message: entry.message,
			isStreaming: entry.isStreaming,
			tokenRevealCss: entry.tokenRevealCss,
			timestampMs: entry.timestampMs,
			planningStartedAtMs: durationStartedAtMs,
		};
	}

	return entry;
}

export function resolveTranscriptViewportSceneEntryCandidate(
	row: TranscriptViewportRow,
	entry: AgentPanelSceneEntryModel | undefined
): AgentPanelSceneEntryModel | null {
	if (entry === undefined) {
		return null;
	}
	if (entry.id === row.sourceEntryId) {
		return withViewportPlanningTiming(entry, row);
	}
	const linkedToolCallId = row.operationLinks[0]?.toolCallId;
	if (
		linkedToolCallId !== undefined &&
		entry.type === "tool_call" &&
		entry.toolCallId === linkedToolCallId
	) {
		return entry;
	}
	return null;
}

function cleanDisplayText(value: string | null | undefined): string | null {
	const text = value?.trim();
	return text === undefined || text.length === 0 ? null : text;
}

function editDiffsFromEntries(
	entries: readonly EditEntry[] | null | undefined
): readonly AgentToolEditDiffEntry[] {
	if (entries === null || entries === undefined || entries.length === 0) {
		return [];
	}

	return entries.map((entry): AgentToolEditDiffEntry => {
		const filePath = cleanDisplayText(entry.filePath) ?? cleanDisplayText(entry.moveFrom);
		const oldString = entry.oldString ?? null;
		const newString = entry.newString ?? entry.content ?? null;
		const stats = calculateDiffStats({
			oldString: oldString ?? "",
			newString: newString ?? "",
		});
		const additions = stats?.added ?? 0;
		const deletions = stats?.removed ?? 0;

		return {
			filePath,
			fileName: filePath === null ? null : getFileName(filePath),
			additions,
			deletions,
			oldString,
			newString,
		};
	});
}

function jsonValueTextSummary(value: JsonValue | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return cleanDisplayText(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (!Array.isArray(value)) {
		const summary = objectValueSummary(value);
		if (summary !== null) {
			return summary;
		}
	}
	return cleanDisplayText(JSON.stringify(value));
}

function objectValueSummary(value: { readonly [key: string]: JsonValue }): string | null {
	const summary = jsonValueTextSummary(value.summary);
	if (summary !== null) {
		return summary;
	}
	const message = jsonValueTextSummary(value.message);
	if (message !== null) {
		return message;
	}
	const output = jsonValueTextSummary(value.output);
	if (output !== null) {
		return output;
	}
	return jsonValueTextSummary(value.error);
}

function formatTokenCount(value: number | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	return value.toLocaleString("en-US");
}

function formatDurationMs(value: number | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (value < 1000) {
		return `${value} ms`;
	}
	return `${(value / 1000).toFixed(1)} s`;
}

function titleForCompactionEvent(event: SessionCompactionEvent): string {
	const summary = cleanDisplayText(event.summary);
	if (summary !== null) {
		return summary;
	}
	if (event.status === "preparing") {
		return "Compaction preparing";
	}
	if (event.status === "failed") {
		return "Compaction failed";
	}
	return "Compaction done";
}

function triggerLabel(value: SessionCompactionEvent["trigger"]): string {
	if (value === "auto") {
		return "Auto";
	}
	if (value === "manual") {
		return "Manual";
	}
	return "Unknown";
}

function subtitleForCompactionEvent(event: SessionCompactionEvent): string | null {
	const droppedTokens = formatTokenCount(event.droppedTokens);
	if (droppedTokens !== null) {
		return `${droppedTokens} tokens freed`;
	}
	if (event.status === "usage_reset") {
		return "Context meter reset";
	}
	return null;
}

function validCompactionTokenCount(value: number | null | undefined): value is number {
	return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

function hasComparableCompactionUsage(event: SessionCompactionEvent): boolean {
	return (
		validCompactionTokenCount(event.preCompactionTokens) &&
		validCompactionTokenCount(event.postCompactionTokens)
	);
}

function contextUsageForCompactionEvent(event: SessionCompactionEvent): {
	readonly preCompactionTokens: number | null;
	readonly postCompactionTokens: number | null;
	readonly contextWindowSize: number | null;
} | null {
	const hasAnyUsageValue =
		event.preCompactionTokens !== null ||
		event.postCompactionTokens !== null ||
		event.contextWindowSize !== null;
	if (!hasAnyUsageValue) {
		return null;
	}
	return {
		preCompactionTokens: event.preCompactionTokens ?? null,
		postCompactionTokens: event.postCompactionTokens ?? null,
		contextWindowSize: event.contextWindowSize ?? null,
	};
}

function compactionMetadata(
	event: SessionCompactionEvent
): { readonly label: string; readonly value: string }[] {
	const metadata: { readonly label: string; readonly value: string }[] = [];
	metadata.push({ label: "Trigger", value: triggerLabel(event.trigger) });

	if (!hasComparableCompactionUsage(event)) {
		const preTokens = formatTokenCount(event.preCompactionTokens);
		if (preTokens !== null) {
			metadata.push({ label: "Before", value: preTokens });
		}

		const postTokens = formatTokenCount(event.postCompactionTokens);
		if (postTokens !== null) {
			metadata.push({ label: "After", value: postTokens });
		}

		const windowSize = formatTokenCount(event.contextWindowSize);
		if (windowSize !== null) {
			metadata.push({ label: "Window", value: windowSize });
		}
	}

	const duration = formatDurationMs(event.durationMs);
	if (duration !== null) {
		metadata.push({ label: "Duration", value: duration });
	}

	if (event.precomputed !== null && event.precomputed !== undefined) {
		metadata.push({ label: "Precomputed", value: event.precomputed ? "Yes" : "No" });
	}

	const preservedMessages = formatTokenCount(event.preservedMessageCount);
	if (preservedMessages !== null) {
		metadata.push({ label: "Preserved", value: preservedMessages });
	}

	const cumulativeDroppedTokens = formatTokenCount(event.cumulativeDroppedTokens);
	if (cumulativeDroppedTokens !== null) {
		metadata.push({ label: "Dropped total", value: cumulativeDroppedTokens });
	}

	return metadata;
}

function commandSummaryFromOperation(operation: OperationSnapshot): string | null {
	const command = cleanDisplayText(operation.command);
	if (command !== null) {
		return command;
	}

	const args = operation.arguments;
	if (args.kind === "execute") return cleanDisplayText(args.command);
	if (args.kind === "shellInput") return cleanDisplayText(args.input);
	if (args.kind === "search") return cleanDisplayText(args.query);
	if (args.kind === "glob") return cleanDisplayText(args.pattern);
	if (args.kind === "fetch") return cleanDisplayText(args.url);
	if (args.kind === "webSearch") return cleanDisplayText(args.query);
	if (args.kind === "think") {
		return (
			cleanDisplayText(args.description) ??
			cleanDisplayText(args.prompt) ??
			cleanDisplayText(args.skill)
		);
	}
	if (args.kind === "taskOutput") return cleanDisplayText(args.task_id);
	if (args.kind === "planMode") {
		return cleanDisplayText(args.title) ?? cleanDisplayText(args.plan_file_path);
	}
	if (args.kind === "toolSearch") return cleanDisplayText(args.query);
	if (args.kind === "browser") {
		return (
			cleanDisplayText(args.action) ??
			cleanDisplayText(args.selector) ??
			cleanDisplayText(args.script)
		);
	}
	if (args.kind === "computer") {
		return cleanDisplayText(args.verb) ?? cleanDisplayText(args.text) ?? cleanDisplayText(args.key);
	}
	if (args.kind === "sql") return cleanDisplayText(args.query);
	if (args.kind === "unclassified") {
		return cleanDisplayText(args.title) ?? cleanDisplayText(args.arguments_preview);
	}
	if (args.kind === "other") return cleanDisplayText(args.intent);
	return null;
}

function targetPathSummaryFromOperation(operation: OperationSnapshot): string | null {
	for (const location of operation.locations ?? []) {
		const path = cleanDisplayText(location.path);
		if (path !== null) {
			return path;
		}
	}

	const args = operation.arguments;
	if (args.kind === "read") return cleanDisplayText(args.file_path);
	if (args.kind === "search") return cleanDisplayText(args.file_path);
	if (args.kind === "delete") {
		return cleanDisplayText(args.file_path) ?? cleanDisplayText(args.file_paths?.[0]);
	}
	if (args.kind === "edit") {
		for (const edit of args.edits) {
			const filePath = cleanDisplayText(edit.filePath);
			if (filePath !== null) {
				return filePath;
			}
		}
		return null;
	}
	if (args.kind === "move") return cleanDisplayText(args.from) ?? cleanDisplayText(args.to);
	if (args.kind === "glob") return cleanDisplayText(args.path);
	if (args.kind === "planMode") return cleanDisplayText(args.plan_file_path);
	return null;
}

function displayFactsFromEmbeddedOperation(
	row: TranscriptViewportRow,
	link: TranscriptViewportOperationLink
): TranscriptViewportOperationDisplayFacts | null {
	const operation = link.operation ?? null;
	if (operation === null) {
		return null;
	}
	if (operation.id !== link.operationId || operation.tool_call_id !== link.toolCallId) {
		return null;
	}
	if (
		operation.source_link.kind !== "transcript_linked" ||
		operation.source_link.entry_id !== row.sourceEntryId
	) {
		return null;
	}

	const title = cleanDisplayText(operation.title) ?? cleanDisplayText(operation.name);
	if (title === null) {
		return null;
	}
	const resultSummary = jsonValueTextSummary(operation.result);
	const errorSummary =
		operation.operation_state === "failed"
			? (resultSummary ?? cleanDisplayText(operation.degradation_reason?.detail))
			: null;
	const interactionIds: string[] = [];
	for (const interactionLink of row.interactionLinks) {
		if (interactionLink.operationId === operation.id) {
			interactionIds.push(interactionLink.interactionId);
		}
	}

	return {
		operationId: operation.id,
		toolCallId: operation.tool_call_id,
		name: operation.name,
		title,
		state: operation.operation_state,
		kind: operation.kind,
		skillName: operation.arguments.kind === "think" ? operation.arguments.skill : null,
		skillArgs: operation.arguments.kind === "think" ? operation.arguments.skill_args : null,
		taskDescription: operation.arguments.kind === "think" ? operation.arguments.description : null,
		taskPrompt: operation.arguments.kind === "think" ? operation.arguments.prompt : null,
		subagentType: operation.arguments.kind === "think" ? operation.arguments.subagent_type : null,
		normalizedTodos: operation.normalized_todos,
		editDiffs: operation.arguments.kind === "edit" ? operation.arguments.edits : undefined,
		commandSummary: commandSummaryFromOperation(operation),
		targetPathSummary: targetPathSummaryFromOperation(operation),
		resultSummary,
		errorSummary,
		interactionIds,
		parentToolCallId: operation.parent_tool_call_id,
		childToolCallIds: operation.child_tool_call_ids.slice(),
	};
}

function mapViewportToolKind(kind: TranscriptViewportOperationDisplayFacts["kind"]): AgentToolKind {
	if (kind === null) {
		return "other";
	}
	if (kind === "shell_input") {
		return "execute";
	}
	if (kind === "glob" || kind === "tool_search") {
		return "search";
	}
	if (
		kind === "read" ||
		kind === "read_lints" ||
		kind === "edit" ||
		kind === "delete" ||
		kind === "execute" ||
		kind === "search" ||
		kind === "fetch" ||
		kind === "web_search" ||
		kind === "think" ||
		kind === "skill" ||
		kind === "task" ||
		kind === "task_output" ||
		kind === "enter_plan_mode" ||
		kind === "exit_plan_mode" ||
		kind === "create_plan" ||
		kind === "browser" ||
		kind === "sql" ||
		kind === "unclassified" ||
		kind === "other"
	) {
		return kind;
	}
	return "other";
}

function defaultViewportToolTitle(kind: AgentToolKind): string {
	if (kind === "execute") return "Run";
	if (kind === "read") return "Read";
	if (kind === "read_lints") return "Read lints";
	if (kind === "edit") return "Edit";
	if (kind === "review") return "Review";
	if (kind === "delete") return "Delete";
	if (kind === "write") return "Write";
	if (kind === "search") return "Search";
	if (kind === "fetch") return "Fetch";
	if (kind === "web_search") return "Web search";
	if (kind === "think") return "Thinking";
	if (kind === "skill") return "Skill";
	if (kind === "task") return "Task";
	if (kind === "task_output") return "Task output";
	if (kind === "enter_plan_mode") return "Enter plan mode";
	if (kind === "exit_plan_mode") return "Plan ready";
	if (kind === "create_plan") return "Create plan";
	if (kind === "browser") return "Browser";
	if (kind === "sql") return "SQL";
	return "Tool";
}

function titleFromDisplayFacts(
	facts: TranscriptViewportOperationDisplayFacts,
	kind: AgentToolKind
): string {
	if (kind !== "other" && kind !== "unclassified") {
		return defaultViewportToolTitle(kind);
	}
	const rawTitle = cleanDisplayText(facts.title) ?? cleanDisplayText(facts.name);
	return rawTitle === null ? defaultViewportToolTitle(kind) : formatOtherToolName(rawTitle);
}

function subtitleFromDisplayFacts(
	facts: TranscriptViewportOperationDisplayFacts,
	kind: AgentToolKind
): string | undefined {
	if (kind === "execute") {
		return undefined;
	}
	return (
		cleanDisplayText(facts.targetPathSummary) ??
		cleanDisplayText(facts.commandSummary) ??
		cleanDisplayText(facts.errorSummary) ??
		cleanDisplayText(facts.resultSummary) ??
		undefined
	);
}

function taskLatestActionFromDisplayFacts(
	action: NonNullable<TranscriptViewportOperationDisplayFacts["latestChildAction"]>
): AgentTaskLatestAction {
	return {
		id: action.operationId,
		kind: mapViewportToolKind(action.kind),
		title: action.title,
		subtitle: action.subtitle ?? undefined,
		filePath: action.targetPathSummary ?? undefined,
		status: toolStatusFromOperationState(action.state),
	};
}

function resolveViewportOperationDisplayFactsEntry(
	row: TranscriptViewportRow
): AgentPanelSceneEntryModel | null {
	if (row.kind !== "tool") {
		return null;
	}
	const operation = row.operationLinks[0];
	const facts =
		operation === undefined
			? null
			: (operation.displayFacts ?? displayFactsFromEmbeddedOperation(row, operation));
	if (facts === null) {
		return null;
	}

	const kind = mapViewportToolKind(facts.kind);
	const status = toolStatusFromOperationState(facts.state);
	const command = kind === "execute" ? cleanDisplayText(facts.commandSummary) : null;
	const resultSummary = cleanDisplayText(facts.resultSummary);
	const errorSummary = cleanDisplayText(facts.errorSummary);
	const targetPath = cleanDisplayText(facts.targetPathSummary);
	const editDiffs = editDiffsFromEntries(facts.editDiffs);
	const query =
		kind === "search" || kind === "web_search" ? cleanDisplayText(facts.commandSummary) : null;
	const fetchUrl = kind === "fetch" ? cleanDisplayText(facts.commandSummary) : null;
	const presentationState = facts.state === "degraded" ? "degraded_operation" : "resolved";

	return {
		id: row.sourceEntryId,
		type: "tool_call",
		toolCallId: facts.toolCallId,
		operationId: facts.operationId,
		kind,
		title: titleFromDisplayFacts(facts, kind),
		subtitle: subtitleFromDisplayFacts(facts, kind),
		detailsText:
			kind === "other" || kind === "unclassified" || kind === "browser" || kind === "sql"
				? (errorSummary ?? resultSummary)
				: null,
		highlightScript: kind === "browser" ? getBrowserScriptHighlighter() : null,
		editDiffs: kind === "edit" ? editDiffs : undefined,
		filePath: targetPath ?? undefined,
		status,
		command,
		commandHtmls: undefined,
		highlightCommand: command ? getExecuteCommandHighlighter() : null,
		highlightOutput: kind === "execute" ? getExecuteOutputHighlighter() : null,
		stdout: kind === "execute" && status === "done" ? resultSummary : null,
		stderr: kind === "execute" && status === "error" ? (errorSummary ?? resultSummary) : null,
		stdoutHtml: null,
		stderrHtml: null,
		query,
		url: fetchUrl,
		resultText: errorSummary ?? resultSummary,
		skillName: kind === "skill" ? (facts.skillName ?? null) : null,
		skillArgs: kind === "skill" ? (facts.skillArgs ?? null) : null,
		taskDescription: kind === "task"
			? ([facts.subagentType, facts.taskDescription].filter(Boolean).join(" · ") || null)
			: null,
		taskPrompt: kind === "task" ? (facts.taskPrompt ?? null) : null,
		taskTranscriptScope:
			kind === "task" && facts.childTranscriptScope?.kind === "operation"
				? {
						kind: "operation",
						operationId: facts.childTranscriptScope.operationId,
					}
				: null,
		taskLatestAction:
			kind === "task" && facts.latestChildAction
				? taskLatestActionFromDisplayFacts(facts.latestChildAction)
				: null,
		todos: facts.normalizedTodos?.map((todo) => {
			return {
				content: todo.content,
				activeForm: todo.activeForm,
				status: todo.status,
				duration: todo.duration ?? null,
			};
		}),
		presentationState,
		degradedReason:
			presentationState === "degraded_operation" ? "Canonical operation is degraded." : null,
	};
}

export function resolveTranscriptViewportSceneEntry(
	row: TranscriptViewportRow
): AgentPanelSceneEntryModel {
	const displayFactsEntry = resolveViewportOperationDisplayFactsEntry(row);
	if (displayFactsEntry !== null) {
		return displayFactsEntry;
	}

	if (row.content.kind === "compaction") {
		return {
			id: row.sourceEntryId,
			type: "session_activity",
			activityKind: "compaction",
			title: titleForCompactionEvent(row.content.event),
			status: row.content.event.status,
			subtitle: subtitleForCompactionEvent(row.content.event),
			contextUsage: contextUsageForCompactionEvent(row.content.event),
			metadata: compactionMetadata(row.content.event),
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "user") {
		const userRow = buildUserRowSceneModel({
			entryId: row.sourceEntryId,
			role: "user",
			segments: row.content.segments,
		});
		return {
			id: row.sourceEntryId,
			type: "user",
			text: userRow.text,
			chunks: userRow.chunks.length > 0 ? userRow.chunks : undefined,
			timestampMs: row.timestampMs ?? undefined,
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "assistant") {
		return {
			id: row.sourceEntryId,
			type: "assistant",
			markdown: segmentText(row.content.segments.filter((segment) => segment.kind === "text")),
			message: {
				chunks: row.content.segments.flatMap((segment) => {
					if (segment.kind === "localCommand" || segment.kind === "compaction") {
						return [];
					}
					return [
						{
							type: segment.kind === "thought" ? "thought" : "message",
							block: {
								type: "text",
								text: segment.text,
							},
						},
					];
				}),
			},
			isStreaming: row.activeStreamingTail !== null,
			planningStartedAtMs: row.durationStartedAtMs ?? null,
			timestampMs: row.timestampMs ?? undefined,
		};
	}

	return {
		id: row.sourceEntryId,
		type: "missing",
		title: "Unavailable transcript row",
		message: "This tool row is missing canonical operation display facts.",
		diagnosticLabel: `row=${row.rowId}`,
	};
}
