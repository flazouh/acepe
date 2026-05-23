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
	AnyAgentEntry,
} from "@acepe/ui/agent-panel/types";
import { AGENT_PANEL_ACTION_IDS } from "@acepe/ui/agent-panel/types";
import type {
	InteractionSnapshot,
	OperationDegradationReason,
	OperationSnapshot,
	TranscriptEntry,
} from "../../services/acp-types.js";
import type { SessionEntry } from "../application/dto/session-entry.js";
import {
	mapSessionEntryToConversationEntry,
	mapToolCallToSceneEntry,
} from "../components/agent-panel/scene/desktop-agent-panel-scene.js";
import { mapCanonicalTurnStateToPresentationStatus } from "../store/canonical-turn-state-mapping.js";
import { normalizeToolResult } from "../store/services/tool-result-normalizer.js";
import type { ToolCall } from "../types/tool-call.js";
import { mapOperationStateToToolPresentationStatus } from "../utils/tool-state-utils.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";

const TRUNCATION_SUFFIX = "\n[truncated]";
const UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT = 40;

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
	readonly graph: AgentPanelCanonicalSource | null;
	readonly header: AgentPanelGraphHeaderInput;
	readonly composer?: AgentPanelComposerModel | null;
	readonly strips?: readonly AgentPanelStripModel[];
	readonly cards?: readonly AgentPanelCardModel[];
	readonly sidebars?: AgentPanelSidebarModel | null;
	readonly chrome?: AgentPanelChromeModel | null;
	readonly optimistic?: {
		readonly pendingUserEntry?: SessionEntry | null;
	} | null;
}

interface OperationIndex {
	readonly byOperationId: Map<string, OperationSnapshot>;
	readonly byTranscriptSourceEntryId: Map<string, OperationSnapshot>;
	readonly parentsByChildOperationId: Map<string, OperationSnapshot[]>;
}

function segmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (text.length > 0 && entry.role !== "assistant") {
			text += "\n";
		}
		text += segment.text;
	}
	return text;
}

function assistantMarkdownText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		if (segment.kind === "text") {
			text += segment.text;
		}
	}

	return text;
}

interface CachedConversationInput {
	readonly graph: AgentPanelCanonicalSource;
}

interface CachedConversationState {
	readonly transcriptEntries: AgentPanelCanonicalSource["transcriptSnapshot"]["entries"];
	readonly operations: AgentPanelCanonicalSource["operations"];
	readonly operationIndex: OperationIndex;
	readonly interactions: AgentPanelCanonicalSource["interactions"];
	readonly turnState: AgentPanelCanonicalSource["turnState"];
	readonly activeStreamingTail: AgentPanelCanonicalSource["activeStreamingTail"];
	readonly activity: AgentPanelCanonicalSource["activity"];
	readonly transcriptEntryById: Map<string, TranscriptEntry>;
	readonly conversation: {
		entries: readonly AgentPanelSceneEntryModel[];
		isStreaming: boolean;
	};
	readonly sceneEntryRowIndex: Map<string, number>;
}

export interface AgentPanelGraphMaterializerReadModel {
	apply(input: AgentPanelGraphMaterializerInput): AgentPanelSceneModel;
}

function buildAssistantMessageFromTranscriptEntry(entry: TranscriptEntry) {
	return {
		chunks: entry.segments.map((segment) => {
			return {
				type: segment.kind === "thought" ? ("thought" as const) : ("message" as const),
				block: {
					type: "text" as const,
					text: segment.text,
				},
			};
		}),
	};
}

export function findLatestLiveAssistantEntry(
	entries: readonly SessionEntry[]
): Extract<SessionEntry, { type: "assistant" }> | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "user") {
			return null;
		}
		if (entry?.type === "assistant") {
			return entry;
		}
	}

	return null;
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
	const byTranscriptSourceEntryId = new Map<string, OperationSnapshot>();
	const parentsByChildOperationId = new Map<string, OperationSnapshot[]>();

	for (const operation of operations) {
		byOperationId.set(operation.id, operation);
		if (operation.source_link.kind === "transcript_linked") {
			byTranscriptSourceEntryId.set(operation.source_link.entry_id, operation);
		}
		for (const childOperationId of operation.child_operation_ids) {
			let parents = parentsByChildOperationId.get(childOperationId);
			if (parents === undefined) {
				parents = [];
				parentsByChildOperationId.set(childOperationId, parents);
			}
			parents.push(operation);
		}
	}

	return {
		byOperationId,
		byTranscriptSourceEntryId,
		parentsByChildOperationId,
	};
}

function findOperationForTranscriptSourceEntry(
	entryId: string,
	index: OperationIndex
): OperationSnapshot | null {
	const linkedOperation = index.byTranscriptSourceEntryId.get(entryId);
	if (linkedOperation !== undefined) {
		return linkedOperation;
	}
	return null;
}

function shouldLogUnresolvedToolDiagnostics(): boolean {
	if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
		return false;
	}

	return localStorage.getItem("acepe:debug:unresolved-tools") === "1";
}

function logUnresolvedToolDiagnostics(
	entry: TranscriptEntry,
	graph: AgentPanelCanonicalSource,
	index: OperationIndex
): void {
	if (!shouldLogUnresolvedToolDiagnostics()) {
		return;
	}

	const transcriptLinkedEntryIds = Array.from(index.byTranscriptSourceEntryId.keys()).slice(
		0,
		UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT
	);
	const operationSummaries = graph.operations
		.slice(0, UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT)
		.map((operation) => {
			return {
				id: operation.id,
				toolCallId: operation.tool_call_id,
				name: operation.name,
				title: operation.title,
				state: operation.operation_state,
				sourceLink: operation.source_link,
			};
		});
	const sampledToolTranscriptEntryCount = countSampledToolTranscriptEntries(
		graph.transcriptSnapshot.entries,
		UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT
	);

	console.warn("[agent-panel] unresolved restored tool row", {
		sessionId: graph.canonicalSessionId,
		agentId: graph.agentId,
		graphRevision: graph.revision.graphRevision,
		transcriptRevision: graph.revision.transcriptRevision,
		lastEventSeq: graph.revision.lastEventSeq,
		turnState: graph.turnState,
		entryId: entry.entryId,
		entrySegmentCount: entry.segments.length,
		entryTextLength: segmentText(entry).length,
		sampledToolTranscriptEntryCount,
		toolTranscriptEntrySampleLimit: UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT,
		operationCount: graph.operations.length,
		transcriptLinkedEntryIds,
		operationSummaries,
	});
}

function countSampledToolTranscriptEntries(
	entries: readonly TranscriptEntry[],
	limit: number
): number {
	let count = 0;
	const sampleLength = Math.min(entries.length, limit);
	for (let index = 0; index < sampleLength; index += 1) {
		if (entries[index]?.role === "tool") {
			count += 1;
		}
	}
	return count;
}

function mapGraphStatus(graph: AgentPanelCanonicalSource): AgentPanelSessionStatus {
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

function materializeLifecycle(graph: AgentPanelCanonicalSource): AgentPanelLifecycleModel {
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

function buildLifecycleActions(graph: AgentPanelCanonicalSource): AgentPanelActionDescriptor[] {
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
		awaitingPlanApproval: operation.awaiting_plan_approval,
		planApprovalRequestId: operation.plan_approval_request_id ?? null,
		progressiveArguments: operation.progressive_arguments ?? undefined,
		startedAtMs: operation.started_at_ms ?? undefined,
		completedAtMs: operation.completed_at_ms ?? undefined,
		presentationStatus: mapOperationStateToToolPresentationStatus(operation.operation_state),
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

	return children;
}

/**
 * Shape-preserving transformer: `(AgentToolEntry) => AgentToolEntry`. Returns a
 * shallow clone of `entry` with truncation applied to long-text fields and
 * `taskChildren` recursively limited.
 *
 * Implementation note — spread carve-out:
 *   This function uses object spread (`...entry`) to clone, then overrides the
 *   five truncation targets (and `taskChildren`) explicitly. This is the
 *   sanctioned exception to the no-spread rule (see `.agent-guides/typescript.md`,
 *   "Explicit Over Implicit"): in a shape-preserving transformer `(x: T) => T`,
 *   spread is the safer default because adding a new field to `AgentToolEntry`
 *   does not silently drop it here. The previous allow-list rebuild had the
 *   opposite property and caused at least one observed bug (`editDiffs` dropped).
 *
 * Safety assumption — read-only pipeline:
 *   Several fields on `AgentToolEntry` are mutable arrays / nested objects
 *   (`searchMatches`, `webSearchLinks`, `todos`, `lintDiagnostics`, `searchFiles`,
 *   `editDiffs`, `question.options`, `taskChildren`). Shallow spread shares those
 *   references. This is safe today because the rendering pipeline downstream of
 *   materialization is read-only — nothing mutates these arrays/objects in place.
 *   If that ever changes (e.g. optimistic-UI patches mutating in place), this
 *   function must move to a deep clone for the affected fields.
 */
export function applySceneTextLimits(entry: AgentToolEntry): AgentToolEntry {
	const taskChildren: AnyAgentEntry[] | undefined =
		entry.taskChildren === undefined
			? undefined
			: entry.taskChildren.map((child) =>
					child.type === "tool_call" ? applySceneTextLimits(child) : child
				);

	return {
		...entry,
		detailsText:
			entry.detailsText === undefined
				? entry.detailsText
				: truncateDisplayText(entry.detailsText, AGENT_PANEL_SCENE_TEXT_LIMITS.details),
		stdout:
			entry.stdout === undefined
				? entry.stdout
				: truncateDisplayText(entry.stdout, AGENT_PANEL_SCENE_TEXT_LIMITS.output),
		stderr:
			entry.stderr === undefined
				? entry.stderr
				: truncateDisplayText(entry.stderr, AGENT_PANEL_SCENE_TEXT_LIMITS.output),
		resultText:
			entry.resultText === undefined
				? entry.resultText
				: truncateDisplayText(entry.resultText, AGENT_PANEL_SCENE_TEXT_LIMITS.result),
		taskResultText:
			entry.taskResultText === undefined
				? entry.taskResultText
				: truncateDisplayText(entry.taskResultText, AGENT_PANEL_SCENE_TEXT_LIMITS.result),
		taskChildren,
	};
}

function materializeOperationEntry(
	operation: OperationSnapshot,
	graph: AgentPanelCanonicalSource,
	index: OperationIndex,
	visitedOperationIds: Set<string>,
	displayEntryId: string | null
): AgentPanelSceneEntryModel {
	if (visitedOperationIds.has(operation.id)) {
		return {
			id: displayEntryId ?? operation.tool_call_id,
			type: "tool_call",
			toolCallId: operation.tool_call_id,
			operationId: operation.id,
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
		childEntries.push(
			materializeOperationEntry(childOperation, graph, index, visitedOperationIds, null)
		);
	}
	visitedOperationIds.delete(operation.id);

	const state = operation.operation_state;
	const toolCall = operationSnapshotToToolCall(operation);
	const presentationState = state === "degraded" ? "degraded_operation" : "resolved";
	const mapped = mapToolCallToSceneEntry(
		toolCall,
		mapCanonicalTurnStateToPresentationStatus(graph.turnState),
		false,
		{
			canonicalStatus: mapOperationStateToToolPresentationStatus(state),
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

	return applySceneTextLimits({
		...mapped,
		id: displayEntryId ?? mapped.id,
		toolCallId: operation.tool_call_id,
		operationId: operation.id,
	});
}

function materializeMissingToolEntry(
	entry: TranscriptEntry,
	graph: AgentPanelCanonicalSource
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
	graph: AgentPanelCanonicalSource,
	index: OperationIndex,
	isStreaming: boolean
): AgentPanelSceneEntryModel {
	if (entry.role === "user") {
		return {
			id: entry.entryId,
			type: "user",
			text: segmentText(entry),
			timestampMs: entry.timestampMs ?? undefined,
		};
	}

	if (entry.role === "assistant") {
		return {
			id: entry.entryId,
			type: "assistant",
			markdown: assistantMarkdownText(entry),
			message: buildAssistantMessageFromTranscriptEntry(entry),
			isStreaming: isStreaming,
			timestampMs: entry.timestampMs ?? undefined,
		};
	}

	if (entry.role === "tool") {
		const operation = findOperationForTranscriptSourceEntry(entry.entryId, index);
		if (operation === null) {
			logUnresolvedToolDiagnostics(entry, graph, index);
			return materializeMissingToolEntry(entry, graph);
		}

		return materializeOperationEntry(operation, graph, index, new Set<string>(), entry.entryId);
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

function questionInteractionToSceneEntry(
	interaction: InteractionSnapshot,
	graph: AgentPanelCanonicalSource
): AgentPanelSceneEntryModel | null {
	if (interaction.kind !== "Question" || interaction.state !== "Pending") {
		return null;
	}
	if (
		graph.activity.blockingInteractionId !== null &&
		interaction.id !== graph.activity.blockingInteractionId
	) {
		return null;
	}
	if (!("Question" in interaction.payload)) {
		return null;
	}

	const question = interaction.payload.Question.questions[0];
	if (question === undefined) {
		return null;
	}

	return {
		id: `interaction:${interaction.id}`,
		type: "tool_call",
		interactionId: interaction.id,
		kind: "other",
		title: "Question",
		subtitle: question.question,
		status: "running",
		question: {
			question: question.question,
			header: question.header,
			options: question.options.map((option) => {
				return {
					label: option.label,
					description: option.description,
				};
			}),
			multiSelect: question.multiSelect,
		},
	};
}

function materializeConversation(graph: AgentPanelCanonicalSource): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
} {
	const isRunning = graph.turnState === "Running";
	const index = buildOperationIndex(graph.operations);
	return materializeConversationWithOperationIndex(graph, index, isRunning);
}

function materializeConversationWithOperationIndex(
	graph: AgentPanelCanonicalSource,
	index: OperationIndex,
	isRunning = graph.turnState === "Running"
): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
} {
	const liveAssistantEntryId = isRunning ? (graph.activeStreamingTail?.rowId ?? null) : null;

	const entries: AgentPanelSceneEntryModel[] = [];
	const entryIds = new Set<string>();
	for (const entry of graph.transcriptSnapshot.entries) {
		const materializedEntry = materializeTranscriptEntry(
			entry,
			graph,
			index,
			isRunning && entry.entryId === liveAssistantEntryId
		);
		entries.push(materializedEntry);
		entryIds.add(materializedEntry.id);
	}

	for (const interaction of graph.interactions) {
		if (entryIds.has(interaction.id)) {
			continue;
		}
		const interactionEntry = questionInteractionToSceneEntry(interaction, graph);
		if (interactionEntry === null) {
			continue;
		}
		entries.push(interactionEntry);
		entryIds.add(interactionEntry.id);
	}

	return {
		entries,
		isStreaming: isRunning,
	};
}

function canReuseConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): previous is CachedConversationState {
	const graph = input.graph;
	return (
		previous !== null &&
		previous.transcriptEntries === graph.transcriptSnapshot.entries &&
		previous.operations === graph.operations &&
		previous.interactions === graph.interactions &&
		previous.turnState === graph.turnState &&
		previous.activeStreamingTail === graph.activeStreamingTail &&
		previous.activity === graph.activity
	);
}

function materializeCachedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState {
	if (canReuseConversation(previous, input)) {
		return previous;
	}

	const operationPatched = materializeOperationPatchedConversation(previous, input);
	if (operationPatched !== null) {
		return operationPatched;
	}

	const transcriptAppended = materializeTranscriptAppendedConversation(previous, input);
	if (transcriptAppended !== null) {
		return transcriptAppended;
	}

	const operationIndex = buildOperationIndex(input.graph.operations);
	const conversation = materializeConversationWithOperationIndex(input.graph, operationIndex);
	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: buildTranscriptEntryIndex(input.graph.transcriptSnapshot.entries),
		conversation,
		sceneEntryRowIndex: buildSceneEntryRowIndex(conversation.entries),
	};
}

function materializeTranscriptAppendedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		previous.activeStreamingTail !== input.graph.activeStreamingTail ||
		previous.activity !== input.graph.activity ||
		!isStableTranscriptAppend(previous.transcriptEntries, input.graph.transcriptSnapshot.entries)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const appendStartIndex = previous.transcriptEntries.length;
	if (appendStartIndex === transcriptEntries.length) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById: previous.transcriptEntryById,
		};
	}

	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const appendedSceneEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = appendStartIndex; index < transcriptEntries.length; index += 1) {
		const entry = transcriptEntries[index];
		if (entry === undefined) {
			continue;
		}
		appendedSceneEntries.push(
			materializeTranscriptEntry(
				entry,
				input.graph,
				previous.operationIndex,
				isRunning && entry.entryId === liveAssistantEntryId
			)
		);
	}
	appendTranscriptEntryIndexFromRange(
		previous.transcriptEntryById,
		transcriptEntries,
		appendStartIndex
	);

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const hasTrailingInteractionEntries =
		previous.conversation.entries.length > transcriptSceneEntryCount;
	const nextEntries = hasTrailingInteractionEntries
		? appendTranscriptEntriesBeforeTrailingInteractions(
				previous.conversation.entries,
				transcriptSceneEntryCount,
				appendedSceneEntries
			)
		: previous.conversation.entries.concat(appendedSceneEntries);
	const sceneEntryRowIndex = hasTrailingInteractionEntries
		? buildSceneEntryRowIndex(nextEntries)
		: appendSceneEntryRowIndex(
				previous.sceneEntryRowIndex,
				appendedSceneEntries,
				transcriptSceneEntryCount
			);

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

function appendTranscriptEntriesBeforeTrailingInteractions(
	previousEntries: readonly AgentPanelSceneEntryModel[],
	transcriptSceneEntryCount: number,
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const appendedIds = new Set<string>();
	for (const entry of appendedSceneEntries) {
		appendedIds.add(entry.id);
	}

	const nextEntries = previousEntries.slice(0, transcriptSceneEntryCount);
	nextEntries.push(...appendedSceneEntries);
	for (let index = transcriptSceneEntryCount; index < previousEntries.length; index += 1) {
		const entry = previousEntries[index];
		if (entry !== undefined && !appendedIds.has(entry.id)) {
			nextEntries.push(entry);
		}
	}
	return nextEntries;
}

function isStableTranscriptAppend(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): boolean {
	if (nextEntries.length < previousEntries.length) {
		return false;
	}

	for (let index = 0; index < previousEntries.length; index += 1) {
		if (nextEntries[index] !== previousEntries[index]) {
			return false;
		}
	}

	return true;
}

function materializeOperationPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.transcriptEntries !== input.graph.transcriptSnapshot.entries ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		previous.activeStreamingTail !== input.graph.activeStreamingTail ||
		previous.activity !== input.graph.activity
	) {
		return null;
	}

	const operationPatch = applyOperationIndexPatch(
		previous.operations,
		input.graph.operations,
		previous.operationIndex
	);
	if (operationPatch === null) {
		return null;
	}
	const { operationIndex, changedOperationIds } = operationPatch;
	if (changedOperationIds.size === 0) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
		};
	}

	const affectedEntryIds = collectAffectedTranscriptEntryIds(
		previous.operationIndex,
		operationIndex,
		changedOperationIds
	);
	if (affectedEntryIds.size === 0) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
		};
	}

	let nextEntries: AgentPanelSceneEntryModel[] | null = null;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	for (const affectedEntryId of affectedEntryIds) {
		const transcriptEntry = previous.transcriptEntryById.get(affectedEntryId);
		if (transcriptEntry === undefined) {
			return null;
		}
		const rowIndex = previous.sceneEntryRowIndex.get(affectedEntryId);
		if (rowIndex === undefined) {
			return null;
		}
		const nextEntry = materializeTranscriptEntry(
			transcriptEntry,
			input.graph,
			operationIndex,
			isRunning && transcriptEntry.entryId === liveAssistantEntryId
		);
		const previousEntry = previous.conversation.entries[rowIndex];
		if (previousEntry !== undefined && areSceneEntriesEquivalent(previousEntry, nextEntry)) {
			continue;
		}
		nextEntries ??= previous.conversation.entries.slice();
		nextEntries[rowIndex] = nextEntry;
	}

	if (nextEntries === null) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
		};
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

function areSceneEntriesEquivalent(
	left: AgentPanelSceneEntryModel,
	right: AgentPanelSceneEntryModel
): boolean {
	return areJsonLikeValuesEquivalent(left, right);
}

function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (typeof left !== typeof right) {
		return false;
	}
	if (left === null || right === null) {
		return false;
	}
	if (typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		return left.every((item, index) => areJsonLikeValuesEquivalent(item, right[index]));
	}

	const leftEntries = Object.entries(left);
	const rightRecord = right as Record<string, unknown>;
	if (leftEntries.length !== Object.keys(rightRecord).length) {
		return false;
	}
	return leftEntries.every(([key, value]) =>
		areJsonLikeValuesEquivalent(value, rightRecord[key])
	);
}

function applyOperationIndexPatch(
	previousOperations: readonly OperationSnapshot[],
	nextOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex
): { operationIndex: OperationIndex; changedOperationIds: Set<string> } | null {
	if (nextOperations.length < previousOperations.length) {
		return null;
	}

	let operationIndex: OperationIndex | null = null;
	const changedOperationIds = new Set<string>();

	for (let index = 0; index < previousOperations.length; index += 1) {
		const previousOperation = previousOperations[index];
		const nextOperation = nextOperations[index];
		if (previousOperation === undefined || nextOperation === undefined) {
			return null;
		}
		if (previousOperation.id !== nextOperation.id) {
			return null;
		}
		if (previousOperation === nextOperation) {
			continue;
		}

		operationIndex ??= cloneOperationIndex(previousIndex);
		replaceOperationInIndex(operationIndex, previousOperation, nextOperation);
		changedOperationIds.add(nextOperation.id);
	}

	if (nextOperations.length > previousOperations.length) {
		operationIndex ??= cloneOperationIndex(previousIndex);
		for (let index = previousOperations.length; index < nextOperations.length; index += 1) {
			const operation = nextOperations[index];
			if (operation === undefined) {
				return null;
			}
			addOperationToIndex(operationIndex, operation);
			changedOperationIds.add(operation.id);
		}
	}

	return {
		operationIndex: operationIndex ?? previousIndex,
		changedOperationIds,
	};
}

function cloneOperationIndex(index: OperationIndex): OperationIndex {
	return {
		byOperationId: new Map(index.byOperationId),
		byTranscriptSourceEntryId: new Map(index.byTranscriptSourceEntryId),
		parentsByChildOperationId: cloneParentOperationIndex(index.parentsByChildOperationId),
	};
}

function cloneParentOperationIndex(
	index: ReadonlyMap<string, readonly OperationSnapshot[]>
): Map<string, OperationSnapshot[]> {
	const cloned = new Map<string, OperationSnapshot[]>();
	for (const [childOperationId, parents] of index) {
		cloned.set(childOperationId, parents.slice());
	}
	return cloned;
}

function replaceOperationInIndex(
	index: OperationIndex,
	previousOperation: OperationSnapshot,
	nextOperation: OperationSnapshot
): void {
	removeOperationFromIndex(index, previousOperation);
	addOperationToIndex(index, nextOperation);
}

function addOperationToIndex(index: OperationIndex, operation: OperationSnapshot): void {
	index.byOperationId.set(operation.id, operation);
	if (operation.source_link.kind === "transcript_linked") {
		index.byTranscriptSourceEntryId.set(operation.source_link.entry_id, operation);
	}
	for (const childOperationId of operation.child_operation_ids) {
		const parents = index.parentsByChildOperationId.get(childOperationId);
		if (parents === undefined) {
			index.parentsByChildOperationId.set(childOperationId, [operation]);
			continue;
		}
		parents.push(operation);
	}
}

function removeOperationFromIndex(index: OperationIndex, operation: OperationSnapshot): void {
	index.byOperationId.delete(operation.id);
	if (operation.source_link.kind === "transcript_linked") {
		const linkedOperation = index.byTranscriptSourceEntryId.get(operation.source_link.entry_id);
		if (linkedOperation?.id === operation.id) {
			index.byTranscriptSourceEntryId.delete(operation.source_link.entry_id);
		}
	}
	for (const childOperationId of operation.child_operation_ids) {
		const parents = index.parentsByChildOperationId.get(childOperationId);
		if (parents === undefined) {
			continue;
		}
		const nextParents = parents.filter((parent) => parent.id !== operation.id);
		if (nextParents.length === 0) {
			index.parentsByChildOperationId.delete(childOperationId);
			continue;
		}
		index.parentsByChildOperationId.set(childOperationId, nextParents);
	}
}

function collectAffectedTranscriptEntryIds(
	previousOperationIndex: OperationIndex,
	operationIndex: OperationIndex,
	changedOperationIds: ReadonlySet<string>
): Set<string> {
	const affectedEntryIds = new Set<string>();
	collectAffectedTranscriptEntryIdsFromIndex(
		previousOperationIndex,
		changedOperationIds,
		affectedEntryIds
	);
	collectAffectedTranscriptEntryIdsFromIndex(operationIndex, changedOperationIds, affectedEntryIds);
	return affectedEntryIds;
}

function buildTranscriptEntryIndex(
	entries: readonly TranscriptEntry[]
): Map<string, TranscriptEntry> {
	const byEntryId = new Map<string, TranscriptEntry>();
	for (const entry of entries) {
		byEntryId.set(entry.entryId, entry);
	}
	return byEntryId;
}

function appendTranscriptEntryIndexFromRange(
	byEntryId: Map<string, TranscriptEntry>,
	entries: readonly TranscriptEntry[],
	startIndex: number
): Map<string, TranscriptEntry> {
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			byEntryId.set(entry.entryId, entry);
		}
	}
	return byEntryId;
}

function collectAffectedTranscriptEntryIdsFromIndex(
	operationIndex: OperationIndex,
	changedOperationIds: ReadonlySet<string>,
	affectedEntryIds: Set<string>
): void {
	for (const operationId of changedOperationIds) {
		const operation = operationIndex.byOperationId.get(operationId);
		if (operation?.source_link.kind === "transcript_linked") {
			affectedEntryIds.add(operation.source_link.entry_id);
		}

		const parents = operationIndex.parentsByChildOperationId.get(operationId);
		if (parents === undefined) {
			continue;
		}
		for (const parentOperation of parents) {
			if (parentOperation.source_link.kind === "transcript_linked") {
				affectedEntryIds.add(parentOperation.source_link.entry_id);
			}
		}
	}
}

function buildSceneEntryRowIndex(
	entries: readonly AgentPanelSceneEntryModel[]
): Map<string, number> {
	const byEntryId = new Map<string, number>();
	entries.forEach((entry, index) => {
		byEntryId.set(entry.id, index);
	});
	return byEntryId;
}

function appendSceneEntryRowIndex(
	byEntryId: Map<string, number>,
	appendedEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): Map<string, number> {
	appendedEntries.forEach((entry, index) => {
		byEntryId.set(entry.id, startIndex + index);
	});
	return byEntryId;
}

function materializeAgentPanelSceneFromConversation(
	input: AgentPanelGraphMaterializerInput,
	conversation: {
		entries: readonly AgentPanelSceneEntryModel[];
		isStreaming: boolean;
	}
): AgentPanelSceneModel {
	if (input.graph === null) {
		return materializeAgentPanelSceneFromGraph(input);
	}

	const status = mapGraphStatus(input.graph);
	let conversationEntries: readonly AgentPanelSceneEntryModel[] = conversation.entries;
	if (input.optimistic?.pendingUserEntry != null) {
		const mapped = mapSessionEntryToConversationEntry(
			input.optimistic.pendingUserEntry,
			undefined,
			{ isOptimistic: true }
		);
		conversationEntries = insertOptimisticUserEntryAtTurnBoundary(conversationEntries, mapped);
	}

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
		conversation: {
			entries: conversationEntries,
			isStreaming: conversation.isStreaming,
		},
		composer: input.composer ?? null,
		strips: input.strips ?? [],
		cards: input.cards ?? [],
		sidebars: input.sidebars ?? null,
		chrome: input.chrome ?? null,
	};
}

export function createAgentPanelGraphMaterializerReadModel(): AgentPanelGraphMaterializerReadModel {
	let previousConversation: CachedConversationState | null = null;

	return {
		apply(input) {
			if (input.graph === null) {
				previousConversation = null;
				return materializeAgentPanelSceneFromGraph(input);
			}

			previousConversation = materializeCachedConversation(previousConversation, {
				graph: input.graph,
			});
			return materializeAgentPanelSceneFromConversation(input, previousConversation.conversation);
		},
	};
}

function insertOptimisticUserEntryAtTurnBoundary(
	entries: readonly AgentPanelSceneEntryModel[],
	entry: AgentPanelSceneEntryModel
): readonly AgentPanelSceneEntryModel[] {
	const nextEntries: AgentPanelSceneEntryModel[] = Array.from(entries);
	let lastUserIndex = -1;
	for (let index = nextEntries.length - 1; index >= 0; index -= 1) {
		if (nextEntries[index]?.type === "user") {
			lastUserIndex = index;
			break;
		}
	}
	if (lastUserIndex !== -1) {
		nextEntries.push(entry);
		return nextEntries;
	}

	const firstToolIndex = nextEntries.findIndex((candidate) => candidate.type === "tool_call");
	if (firstToolIndex === -1) {
		nextEntries.push(entry);
		return nextEntries;
	}

	nextEntries.splice(firstToolIndex, 0, entry);
	return nextEntries;
}

export function materializeAgentPanelSceneFromGraph(
	input: AgentPanelGraphMaterializerInput
): AgentPanelSceneModel {
	if (input.graph === null) {
		const preSesssionLifecycle: AgentPanelLifecycleModel = {
			status: "activating",
			detachedReason: null,
			failureReason: null,
			errorMessage: null,
			actionability: {
				canSend: false,
				canResume: false,
				canRetry: false,
				canArchive: false,
				canConfigure: false,
				recommendedAction: "wait",
				recoveryPhase: "none",
				compactStatus: "activating",
			},
		};

		const optimisticEntries: AgentPanelSceneEntryModel[] = [];
		if (input.optimistic?.pendingUserEntry != null) {
			const mapped = mapSessionEntryToConversationEntry(
				input.optimistic.pendingUserEntry,
				undefined,
				{ isOptimistic: true }
			);
			optimisticEntries.push(mapped);
		}

		return {
			panelId: input.panelId,
			status: "warming",
			lifecycle: preSesssionLifecycle,
			header: {
				title: input.header.title,
				subtitle: input.header.subtitle ?? null,
				status: "warming",
				agentIconSrc: input.header.agentIconSrc ?? null,
				agentLabel: input.header.agentLabel ?? null,
				projectLabel: input.header.projectLabel ?? null,
				projectColor: input.header.projectColor ?? null,
				sequenceId: input.header.sequenceId ?? null,
				branchLabel: input.header.branchLabel ?? null,
				actions: input.header.actions ?? [],
			},
			conversation: {
				entries: optimisticEntries,
				isStreaming: false,
			},
			composer: input.composer ?? null,
			strips: input.strips ?? [],
			cards: input.cards ?? [],
			sidebars: input.sidebars ?? null,
			chrome: input.chrome ?? null,
		};
	}

	const status = mapGraphStatus(input.graph);
	const conversation = materializeConversation(input.graph);

	let conversationEntries: readonly AgentPanelSceneEntryModel[] = conversation.entries;
	if (input.optimistic?.pendingUserEntry != null) {
		const mapped = mapSessionEntryToConversationEntry(
			input.optimistic.pendingUserEntry,
			undefined,
			{ isOptimistic: true }
		);
		conversationEntries = insertOptimisticUserEntryAtTurnBoundary(conversationEntries, mapped);
	}
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
		conversation: {
			entries: conversationEntries,
			isStreaming: conversation.isStreaming,
		},
		composer: input.composer ?? null,
		strips: input.strips ?? [],
		cards: input.cards ?? [],
		sidebars: input.sidebars ?? null,
		chrome: input.chrome ?? null,
	};
}
