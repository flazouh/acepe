import type {
	AgentPanelActionDescriptor,
	AgentPanelCardModel,
	AgentPanelChromeModel,
	AgentPanelComposerModel,
	AgentPanelLifecycleModel,
	AgentPanelSceneEntryModel,
	AgentPanelSceneModel,
	AgentPanelSessionStatus,
	AgentPanelSidebarModel,
	AgentPanelStripModel,
	AgentToolEntry,
	AgentToolStatus,
	AnyAgentEntry,
} from "@acepe/ui/agent-panel";
import { AGENT_PANEL_ACTION_IDS } from "@acepe/ui/agent-panel";
import type {
	OperationDegradationReason,
	OperationSnapshot,
	OperationState,
	SessionStateGraph,
	TranscriptEntry,
} from "../../services/acp-types.js";
import { mapToolCallToSceneEntry } from "../components/agent-panel/scene/desktop-agent-panel-scene.js";
import { mapCanonicalTurnStateToHotTurnState } from "../store/canonical-turn-state-mapping.js";
import { normalizeToolResult } from "../store/services/tool-result-normalizer.js";
import type { ToolCall } from "../types/tool-call.js";

const TRUNCATION_SUFFIX = "\n[truncated]";

export const AGENT_PANEL_SCENE_TEXT_LIMITS = {
	output: 12000,
	result: 12000,
	details: 8000,
};

export interface AgentPanelGraphHeaderInput {
	readonly title: string;
	readonly subtitle?: string | null;
	readonly agentIconSrc?: string | null;
	readonly agentLabel?: string | null;
	readonly projectLabel?: string | null;
	readonly projectColor?: string | null;
	readonly sequenceId?: number | null;
	readonly branchLabel?: string | null;
	readonly actions?: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelGraphMaterializerInput {
	readonly panelId: string;
	readonly graph: SessionStateGraph;
	readonly header: AgentPanelGraphHeaderInput;
	readonly composer?: AgentPanelComposerModel | null;
	readonly strips?: readonly AgentPanelStripModel[];
	readonly cards?: readonly AgentPanelCardModel[];
	readonly sidebars?: AgentPanelSidebarModel | null;
	readonly chrome?: AgentPanelChromeModel | null;
}

interface OperationIndex {
	readonly byOperationId: Map<string, OperationSnapshot>;
	readonly bySourceEntryId: Map<string, OperationSnapshot>;
	readonly byToolCallId: Map<string, OperationSnapshot>;
	readonly byProvenanceKey: Map<string, OperationSnapshot>;
}

function segmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (text.length > 0) {
			text += "\n";
		}
		text += segment.text;
	}
	return text;
}

function truncateDisplayText(
	value: string | null | undefined,
	limit: number
): string | null | undefined {
	if (value === null || value === undefined || value.length <= limit) {
		return value;
	}

	const available = Math.max(0, limit - TRUNCATION_SUFFIX.length);
	return `${value.slice(0, available)}${TRUNCATION_SUFFIX}`;
}

function buildOperationIndex(operations: readonly OperationSnapshot[]): OperationIndex {
	const byOperationId = new Map<string, OperationSnapshot>();
	const bySourceEntryId = new Map<string, OperationSnapshot>();
	const byToolCallId = new Map<string, OperationSnapshot>();
	const byProvenanceKey = new Map<string, OperationSnapshot>();

	for (const operation of operations) {
		byOperationId.set(operation.id, operation);
		byToolCallId.set(operation.tool_call_id, operation);
		if (
			operation.operation_provenance_key !== null &&
			operation.operation_provenance_key !== undefined
		) {
			byProvenanceKey.set(operation.operation_provenance_key, operation);
		}
		if (operation.source_entry_id !== null && operation.source_entry_id !== undefined) {
			bySourceEntryId.set(operation.source_entry_id, operation);
		}
	}

	return {
		byOperationId,
		bySourceEntryId,
		byToolCallId,
		byProvenanceKey,
	};
}

function findOperationForTranscriptEntry(
	entry: TranscriptEntry,
	index: OperationIndex
): OperationSnapshot | null {
	return (
		index.bySourceEntryId.get(entry.entryId) ??
		index.byToolCallId.get(entry.entryId) ??
		index.byProvenanceKey.get(entry.entryId) ??
		index.byOperationId.get(entry.entryId) ??
		null
	);
}

function deriveOperationState(operation: OperationSnapshot): OperationState {
	if (operation.operation_state !== null && operation.operation_state !== undefined) {
		return operation.operation_state;
	}

	if (operation.provider_status === "pending") {
		return "pending";
	}
	if (operation.provider_status === "in_progress") {
		return "running";
	}
	if (operation.provider_status === "completed") {
		return "completed";
	}
	return "failed";
}

function mapOperationStateToToolStatus(state: OperationState): AgentToolStatus {
	if (state === "pending") {
		return "pending";
	}
	if (state === "running") {
		return "running";
	}
	if (state === "blocked") {
		return "blocked";
	}
	if (state === "completed") {
		return "done";
	}
	if (state === "cancelled") {
		return "cancelled";
	}
	if (state === "degraded") {
		return "degraded";
	}
	return "error";
}

function mapGraphStatus(graph: SessionStateGraph): AgentPanelSessionStatus {
	const lifecycleStatus = graph.lifecycle.status;
	if (
		lifecycleStatus === "failed" ||
		graph.activity.kind === "error" ||
		graph.turnState === "Failed"
	) {
		return "error";
	}
	if (
		lifecycleStatus === "reserved" ||
		lifecycleStatus === "activating" ||
		lifecycleStatus === "reconnecting"
	) {
		return "warming";
	}
	if (lifecycleStatus === "detached" || lifecycleStatus === "archived") {
		return "idle";
	}
	if (
		graph.activity.kind === "running_operation" ||
		graph.activity.kind === "awaiting_model" ||
		graph.turnState === "Running"
	) {
		return "running";
	}
	if (graph.turnState === "Completed") {
		return "done";
	}
	return graph.transcriptSnapshot.entries.length > 0 ? "idle" : "connected";
}

function materializeLifecycle(graph: SessionStateGraph): AgentPanelLifecycleModel {
	return {
		status: graph.lifecycle.status,
		detachedReason: graph.lifecycle.detachedReason ?? null,
		failureReason: graph.lifecycle.failureReason ?? null,
		errorMessage: graph.lifecycle.errorMessage ?? null,
		actionability: {
			canSend: graph.lifecycle.actionability.canSend,
			canResume: graph.lifecycle.actionability.canResume,
			canRetry: graph.lifecycle.actionability.canRetry,
			canArchive: graph.lifecycle.actionability.canArchive,
			canConfigure: graph.lifecycle.actionability.canConfigure,
			recommendedAction: graph.lifecycle.actionability.recommendedAction,
			recoveryPhase: graph.lifecycle.actionability.recoveryPhase,
			compactStatus: graph.lifecycle.actionability.compactStatus,
		},
	};
}

function buildLifecycleActions(graph: SessionStateGraph): AgentPanelActionDescriptor[] {
	const actions: AgentPanelActionDescriptor[] = [];

	if (graph.lifecycle.actionability.canResume) {
		actions.push({
			id: AGENT_PANEL_ACTION_IDS.status.resume,
			label: "Resume",
			state: "enabled",
		});
	}

	if (graph.lifecycle.actionability.canRetry) {
		actions.push({
			id: AGENT_PANEL_ACTION_IDS.status.retry,
			label: "Retry",
			state: "enabled",
		});
	}

	if (graph.lifecycle.actionability.canArchive) {
		actions.push({
			id: AGENT_PANEL_ACTION_IDS.status.archive,
			label: "Archive",
			state: "enabled",
		});
	}

	return actions;
}

function displaySafeDegradationReason(
	reason: OperationDegradationReason | null | undefined
): string {
	if (reason === null || reason === undefined) {
		return "Tool operation is degraded.";
	}

	if (reason.code === "classification_failure") {
		return "Tool operation could not be classified safely.";
	}
	if (reason.code === "missing_evidence") {
		return "Tool operation is missing canonical evidence.";
	}
	if (reason.code === "absent_from_history") {
		return "Tool operation is absent from provider history.";
	}
	if (reason.code === "invalid_provenance_key") {
		return "Tool operation has invalid provenance.";
	}
	return "Tool operation has an impossible state transition.";
}

function operationSnapshotToToolCall(operation: OperationSnapshot): ToolCall {
	return {
		id: operation.tool_call_id,
		name: operation.name,
		arguments: operation.arguments,
		rawInput: null,
		status:
			operation.provider_status === "pending" ||
			operation.provider_status === "in_progress" ||
			operation.provider_status === "completed"
				? operation.provider_status
				: "failed",
		result: operation.result,
		normalizedResult: normalizeToolResult({
			kind: operation.kind,
			arguments: operation.arguments,
			result: operation.result,
		}),
		kind: operation.kind,
		title: operation.title,
		locations: operation.locations ?? null,
		skillMeta: operation.skill_meta ?? null,
		normalizedQuestions: operation.normalized_questions ?? null,
		normalizedTodos: operation.normalized_todos ?? null,
		parentToolUseId: operation.parent_tool_call_id,
		taskChildren: null,
		questionAnswer: operation.question_answer ?? null,
		awaitingPlanApproval: operation.awaiting_plan_approval ?? false,
		planApprovalRequestId: operation.plan_approval_request_id ?? null,
		progressiveArguments: operation.progressive_arguments ?? undefined,
		startedAtMs: operation.started_at_ms ?? undefined,
		completedAtMs: operation.completed_at_ms ?? undefined,
	};
}

function collectChildOperations(
	operation: OperationSnapshot,
	index: OperationIndex
): OperationSnapshot[] {
	const children: OperationSnapshot[] = [];
	const seenOperationIds = new Set<string>();

	for (const operationId of operation.child_operation_ids) {
		const child = index.byOperationId.get(operationId);
		if (child === undefined || seenOperationIds.has(child.id)) {
			continue;
		}
		children.push(child);
		seenOperationIds.add(child.id);
	}

	for (const toolCallId of operation.child_tool_call_ids) {
		const child = index.byToolCallId.get(toolCallId);
		if (child === undefined || seenOperationIds.has(child.id)) {
			continue;
		}
		children.push(child);
		seenOperationIds.add(child.id);
	}

	return children;
}

function applySceneTextLimits(entry: AgentToolEntry): AgentToolEntry {
	const limited: AgentToolEntry = {
		id: entry.id,
		type: "tool_call",
		title: entry.title,
		status: entry.status,
	};
	if (entry.kind !== undefined) limited.kind = entry.kind;
	if (entry.subtitle !== undefined) limited.subtitle = entry.subtitle;
	if (entry.detailsText !== undefined) {
		limited.detailsText = truncateDisplayText(
			entry.detailsText,
			AGENT_PANEL_SCENE_TEXT_LIMITS.details
		);
	}
	if (entry.scriptText !== undefined) limited.scriptText = entry.scriptText;
	if (entry.filePath !== undefined) limited.filePath = entry.filePath;
	if (entry.sourceExcerpt !== undefined) limited.sourceExcerpt = entry.sourceExcerpt;
	if (entry.sourceRangeLabel !== undefined) limited.sourceRangeLabel = entry.sourceRangeLabel;
	if (entry.command !== undefined) limited.command = entry.command;
	if (entry.stdout !== undefined) {
		limited.stdout = truncateDisplayText(entry.stdout, AGENT_PANEL_SCENE_TEXT_LIMITS.output);
	}
	if (entry.stderr !== undefined) {
		limited.stderr = truncateDisplayText(entry.stderr, AGENT_PANEL_SCENE_TEXT_LIMITS.output);
	}
	if (entry.exitCode !== undefined) limited.exitCode = entry.exitCode;
	if (entry.query !== undefined) limited.query = entry.query;
	if (entry.searchPath !== undefined) limited.searchPath = entry.searchPath;
	if (entry.searchFiles !== undefined) limited.searchFiles = entry.searchFiles;
	if (entry.searchResultCount !== undefined) limited.searchResultCount = entry.searchResultCount;
	if (entry.url !== undefined) limited.url = entry.url;
	if (entry.resultText !== undefined) {
		limited.resultText = truncateDisplayText(entry.resultText, AGENT_PANEL_SCENE_TEXT_LIMITS.result);
	}
	if (entry.webSearchLinks !== undefined) limited.webSearchLinks = entry.webSearchLinks;
	if (entry.webSearchSummary !== undefined) limited.webSearchSummary = entry.webSearchSummary;
	if (entry.skillName !== undefined) limited.skillName = entry.skillName;
	if (entry.skillArgs !== undefined) limited.skillArgs = entry.skillArgs;
	if (entry.skillDescription !== undefined) limited.skillDescription = entry.skillDescription;
	if (entry.taskDescription !== undefined) limited.taskDescription = entry.taskDescription;
	if (entry.taskPrompt !== undefined) limited.taskPrompt = entry.taskPrompt;
	if (entry.taskResultText !== undefined) {
		limited.taskResultText = truncateDisplayText(
			entry.taskResultText,
			AGENT_PANEL_SCENE_TEXT_LIMITS.result
		);
	}

	if (entry.taskChildren !== undefined) {
		const nextChildren: AnyAgentEntry[] = [];
		for (const child of entry.taskChildren) {
			if (child.type === "tool_call") {
				nextChildren.push(applySceneTextLimits(child));
			} else {
				nextChildren.push(child);
			}
		}
		limited.taskChildren = nextChildren;
	}
	if (entry.presentationState !== undefined) limited.presentationState = entry.presentationState;
	if (entry.degradedReason !== undefined) limited.degradedReason = entry.degradedReason;
	if (entry.todos !== undefined) limited.todos = entry.todos;
	if (entry.question !== undefined) limited.question = entry.question;
	if (entry.lintDiagnostics !== undefined) limited.lintDiagnostics = entry.lintDiagnostics;

	return limited;
}

function materializeOperationEntry(
	operation: OperationSnapshot,
	graph: SessionStateGraph,
	index: OperationIndex,
	visitedOperationIds: Set<string>
): AgentPanelSceneEntryModel {
	if (visitedOperationIds.has(operation.id)) {
		return {
			id: operation.tool_call_id,
			type: "tool_call",
			kind: "other",
			title: "Unresolved tool",
			subtitle: "Operation cycle detected",
			status: "degraded",
			presentationState: "degraded_operation",
			degradedReason: "Canonical operation graph contains a cycle.",
		};
	}

	visitedOperationIds.add(operation.id);
	const childEntries: AgentPanelSceneEntryModel[] = [];
	for (const childOperation of collectChildOperations(operation, index)) {
		childEntries.push(materializeOperationEntry(childOperation, graph, index, visitedOperationIds));
	}
	visitedOperationIds.delete(operation.id);

	const state = deriveOperationState(operation);
	const toolCall = operationSnapshotToToolCall(operation);
	const presentationState = state === "degraded" ? "degraded_operation" : "resolved";
	const mapped = mapToolCallToSceneEntry(
		toolCall,
		mapCanonicalTurnStateToHotTurnState(graph.turnState),
		false,
		null,
		{
			canonicalStatus: mapOperationStateToToolStatus(state),
			presentationState,
			degradedReason:
				state === "degraded" ? displaySafeDegradationReason(operation.degradation_reason) : null,
			taskChildren: childEntries,
			includeDiagnosticDetails: false,
		}
	);

	if (mapped.type !== "tool_call") {
		return mapped;
	}

	return applySceneTextLimits(mapped);
}

function materializeMissingToolEntry(
	entry: TranscriptEntry,
	graph: SessionStateGraph
): AgentPanelSceneEntryModel {
	const text = truncateDisplayText(segmentText(entry), AGENT_PANEL_SCENE_TEXT_LIMITS.result) ?? "";
	const isLiveRace = graph.turnState === "Running";
	if (isLiveRace) {
		return {
			id: entry.entryId,
			type: "tool_call",
			kind: "other",
			title: "Tool pending",
			subtitle: text.length > 0 ? text : undefined,
			status: "pending",
			presentationState: "pending_operation",
			degradedReason: null,
		};
	}

	return {
		id: entry.entryId,
		type: "tool_call",
		kind: "other",
		title: "Unresolved tool",
		subtitle: text.length > 0 ? text : undefined,
		status: "degraded",
		presentationState: "degraded_operation",
		degradedReason: "No canonical operation was found for this restored transcript tool row.",
	};
}

function materializeTranscriptEntry(
	entry: TranscriptEntry,
	graph: SessionStateGraph,
	index: OperationIndex
): AgentPanelSceneEntryModel {
	if (entry.role === "user") {
		return {
			id: entry.entryId,
			type: "user",
			text: segmentText(entry),
		};
	}

	if (entry.role === "assistant") {
		return {
			id: entry.entryId,
			type: "assistant",
			markdown: segmentText(entry),
			isStreaming: undefined,
		};
	}

	if (entry.role === "tool") {
		const operation = findOperationForTranscriptEntry(entry, index);
		if (operation === null) {
			return materializeMissingToolEntry(entry, graph);
		}

		return materializeOperationEntry(operation, graph, index, new Set<string>());
	}

	return {
		id: entry.entryId,
		type: "tool_call",
		kind: "other",
		title: "Error",
		status: "error",
		resultText: truncateDisplayText(segmentText(entry), AGENT_PANEL_SCENE_TEXT_LIMITS.result),
	};
}

function materializeConversation(graph: SessionStateGraph): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
} {
	const index = buildOperationIndex(graph.operations);
	const entries: AgentPanelSceneEntryModel[] = [];

	for (const entry of graph.transcriptSnapshot.entries) {
		entries.push(materializeTranscriptEntry(entry, graph, index));
	}

	return {
		entries,
		isStreaming: graph.turnState === "Running",
	};
}

export function materializeAgentPanelSceneFromGraph(
	input: AgentPanelGraphMaterializerInput
): AgentPanelSceneModel {
	const status = mapGraphStatus(input.graph);
	return {
		panelId: input.panelId,
		status,
		lifecycle: materializeLifecycle(input.graph),
		header: {
			title: input.header.title,
			subtitle: input.header.subtitle ?? null,
			status,
			agentIconSrc: input.header.agentIconSrc ?? null,
			agentLabel: input.header.agentLabel ?? null,
			projectLabel: input.header.projectLabel ?? null,
			projectColor: input.header.projectColor ?? null,
			sequenceId: input.header.sequenceId ?? null,
			branchLabel: input.header.branchLabel ?? null,
			actions: input.header.actions ?? buildLifecycleActions(input.graph),
		},
		conversation: materializeConversation(input.graph),
		composer: input.composer ?? null,
		strips: input.strips ?? [],
		cards: input.cards ?? [],
		sidebars: input.sidebars ?? null,
		chrome: input.chrome ?? null,
	};
}
