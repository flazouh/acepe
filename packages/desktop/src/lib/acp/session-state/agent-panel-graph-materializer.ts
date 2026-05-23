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
import {
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArrayPatch,
	markAgentPanelSceneEntryArraySplicePatch,
	markAgentPanelSceneEntryArrayTruncation,
} from "./agent-panel-scene-entry-array-patch.js";
import { getInteractionSnapshotArrayPatch } from "./interaction-snapshot-array-patch.js";
import { getOperationSnapshotArrayPatch } from "./operation-snapshot-array-patch.js";
import { getTranscriptEntryArrayPatch } from "./transcript-entry-array-patch.js";

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

type OperationIndexPatchResult = {
	readonly operationIndex: OperationIndex;
	readonly changedOperationIds: Set<string>;
	readonly affectedEntryIds?: Set<string>;
};

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
	readonly interactionById: ReadonlyMap<string, InteractionSnapshot>;
	readonly turnState: AgentPanelCanonicalSource["turnState"];
	readonly activeStreamingTail: AgentPanelCanonicalSource["activeStreamingTail"];
	readonly activity: AgentPanelCanonicalSource["activity"];
	readonly transcriptEntryById: ReadonlyMap<string, TranscriptEntry>;
	readonly conversation: {
		entries: readonly AgentPanelSceneEntryModel[];
		isStreaming: boolean;
	};
	readonly sceneEntryRowIndex: ReadonlyMap<string, number>;
}

export interface AgentPanelGraphMaterializerReadModel {
	apply(input: AgentPanelGraphMaterializerInput): AgentPanelSceneModel;
}

function buildAssistantMessageFromTranscriptEntry(entry: TranscriptEntry) {
	const chunks: Array<{
		readonly type: "thought" | "message";
		readonly block: {
			readonly type: "text";
			readonly text: string;
		};
	}> = [];
	for (const segment of entry.segments) {
		chunks.push({
			type: segment.kind === "thought" ? "thought" : "message",
			block: {
				type: "text",
				text: segment.text,
			},
		});
	}
	return {
		chunks,
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
		id: interactionSceneEntryId(interaction.id),
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
		areActiveStreamingTailsEquivalent(previous.activeStreamingTail, graph.activeStreamingTail) &&
		areActivitiesEquivalent(previous.activity, graph.activity)
	);
}

function canReuseConversationEntriesWithUpdatedActivity(
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
		areActiveStreamingTailsEquivalent(previous.activeStreamingTail, graph.activeStreamingTail)
	);
}

function materializeCachedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState {
	if (canReuseConversation(previous, input)) {
		return previous;
	}

	if (canReuseConversationEntriesWithUpdatedActivity(previous, input)) {
		const cachedConversation = previous as CachedConversationState;
		return {
			...cachedConversation,
			activity: input.graph.activity,
		};
	}

	const operationPatched = materializeOperationPatchedConversation(previous, input);
	if (operationPatched !== null) {
		return operationPatched;
	}

	const streamingStatePatched = materializeStreamingStatePatchedConversation(previous, input);
	if (streamingStatePatched !== null) {
		return streamingStatePatched;
	}

	const transcriptArrayPatched = materializeTranscriptArrayPatchedConversation(previous, input);
	if (transcriptArrayPatched !== null) {
		return transcriptArrayPatched;
	}

	const transcriptPatchedAndAppended = materializeTranscriptPatchedAndAppendedConversation(
		previous,
		input
	);
	if (transcriptPatchedAndAppended !== null) {
		return transcriptPatchedAndAppended;
	}

	const transcriptPatched = materializeTranscriptPatchedConversation(previous, input);
	if (transcriptPatched !== null) {
		return transcriptPatched;
	}

	const transcriptTruncated = materializeTranscriptTruncatedConversation(previous, input);
	if (transcriptTruncated !== null) {
		return transcriptTruncated;
	}

	const transcriptAppended = materializeTranscriptAppendedConversation(previous, input);
	if (transcriptAppended !== null) {
		return transcriptAppended;
	}

	const interactionPatched = materializeInteractionPatchedConversation(previous, input);
	if (interactionPatched !== null) {
		return interactionPatched;
	}

	const operationIndex = buildOperationIndex(input.graph.operations);
	const conversation = materializeConversationWithOperationIndex(input.graph, operationIndex);
	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: buildTranscriptEntryIndex(input.graph.transcriptSnapshot.entries),
		conversation,
		sceneEntryRowIndex: buildSceneEntryRowIndex(conversation.entries),
	};
}

function materializeTranscriptArrayPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const transcriptPatch = getTranscriptEntryArrayPatch(transcriptEntries);
	if (
		transcriptPatch === undefined ||
		transcriptPatch.baseEntries !== previous.transcriptEntries ||
		transcriptPatch.appendedEntries !== null ||
		transcriptPatch.patchedEntriesByIndex === null
	) {
		return null;
	}

	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	let transcriptEntryPatches: Map<string, TranscriptEntry> | null = null;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;

	for (const [index, nextTranscriptEntry] of transcriptPatch.patchedEntriesByIndex) {
		const previousTranscriptEntry = previous.transcriptEntries[index];
		if (
			previousTranscriptEntry === undefined ||
			previousTranscriptEntry.entryId !== nextTranscriptEntry.entryId
		) {
			return null;
		}

		const rowIndex = previous.sceneEntryRowIndex.get(nextTranscriptEntry.entryId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousSceneEntry = previous.conversation.entries[rowIndex];
		if (previousSceneEntry === undefined) {
			return null;
		}
		const nextSceneEntry = materializeTranscriptEntry(
			nextTranscriptEntry,
			input.graph,
			previous.operationIndex,
			isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
		);
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		if (areSceneEntriesEquivalent(previousSceneEntry, nextSceneEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextSceneEntry);
	}

	if (entryPatches === null) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById:
				transcriptEntryPatches === null
					? previous.transcriptEntryById
					: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById:
			transcriptEntryPatches === null
				? previous.transcriptEntryById
				: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
		conversation: {
			entries: createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

function materializeStreamingStatePatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.transcriptEntries !== input.graph.transcriptSnapshot.entries ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions
	) {
		return null;
	}

	if (!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)) {
		return null;
	}

	const previousIsRunning = previous.turnState === "Running";
	const nextIsRunning = input.graph.turnState === "Running";
	const previousTailRowId = previousIsRunning ? (previous.activeStreamingTail?.rowId ?? null) : null;
	const nextTailRowId = nextIsRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const rowIdsToPatch = new Set<string>();
	if (previousTailRowId !== null) {
		rowIdsToPatch.add(previousTailRowId);
	}
	if (nextTailRowId !== null) {
		rowIdsToPatch.add(nextTailRowId);
	}

	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	for (const rowId of rowIdsToPatch) {
		const transcriptEntry = previous.transcriptEntryById.get(rowId);
		if (transcriptEntry === undefined) {
			return null;
		}
		const rowIndex = previous.sceneEntryRowIndex.get(rowId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousEntry = previous.conversation.entries[rowIndex];
		if (previousEntry === undefined) {
			return null;
		}
		const nextEntry = materializeTranscriptEntry(
			transcriptEntry,
			input.graph,
			previous.operationIndex,
			nextIsRunning && transcriptEntry.entryId === nextTailRowId
		);
		if (areSceneEntriesEquivalent(previousEntry, nextEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextEntry);
	}

	const nextConversationIsStreaming = nextIsRunning;
	if (entryPatches === null && previous.conversation.isStreaming === nextConversationIsStreaming) {
		return {
			...previous,
			turnState: input.graph.turnState,
			activeStreamingTail: input.graph.activeStreamingTail,
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries:
				entryPatches === null
					? previous.conversation.entries
					: createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
			isStreaming: nextConversationIsStreaming,
		},
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

function materializeTranscriptPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity) ||
		previous.transcriptEntries.length !== input.graph.transcriptSnapshot.entries.length
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	let transcriptEntryPatches: Map<string, TranscriptEntry> | null = null;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;

	for (let index = 0; index < transcriptEntries.length; index += 1) {
		const previousTranscriptEntry = previous.transcriptEntries[index];
		const nextTranscriptEntry = transcriptEntries[index];
		if (previousTranscriptEntry === undefined || nextTranscriptEntry === undefined) {
			return null;
		}
		if (previousTranscriptEntry.entryId !== nextTranscriptEntry.entryId) {
			return null;
		}
		if (previousTranscriptEntry === nextTranscriptEntry) {
			continue;
		}

		const rowIndex = previous.sceneEntryRowIndex.get(nextTranscriptEntry.entryId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousSceneEntry = previous.conversation.entries[rowIndex];
		if (previousSceneEntry === undefined) {
			return null;
		}
		const nextSceneEntry = materializeTranscriptEntry(
			nextTranscriptEntry,
			input.graph,
			previous.operationIndex,
			isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
		);
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		if (areSceneEntriesEquivalent(previousSceneEntry, nextSceneEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextSceneEntry);
	}

	if (entryPatches === null) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById:
				transcriptEntryPatches === null
					? previous.transcriptEntryById
					: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById:
			transcriptEntryPatches === null
				? previous.transcriptEntryById
				: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
		conversation: {
			entries: createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

function materializeTranscriptPatchedAndAppendedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const transcriptPatch = getTranscriptEntryArrayPatch(transcriptEntries);
	const hasMarkedAppendOnly =
		transcriptPatch?.baseEntries === previous.transcriptEntries &&
		transcriptPatch.patchedEntriesByIndex === null &&
		transcriptPatch.appendedEntries !== null;
	const hasMarkedPatchAndAppend =
		transcriptPatch?.baseEntries === previous.transcriptEntries &&
		transcriptPatch.patchedEntriesByIndex !== null &&
		transcriptPatch.appendedEntries !== null;
	const hasStablePatchAndAppend =
		!hasMarkedAppendOnly &&
		!hasMarkedPatchAndAppend &&
		transcriptEntries.length > previous.transcriptEntries.length &&
		isStableTranscriptPatchAndAppend(previous.transcriptEntries, transcriptEntries);
	if (
		!hasMarkedPatchAndAppend &&
		!hasStablePatchAndAppend
	) {
		return null;
	}

	const appendStartIndex = previous.transcriptEntries.length;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const patchedEntriesByIndex =
		hasMarkedPatchAndAppend
			? transcriptPatch.patchedEntriesByIndex
			: collectStableTranscriptPatchedEntriesByIndex(previous.transcriptEntries, transcriptEntries);
	const appendedTranscriptEntries =
		hasMarkedPatchAndAppend
			? transcriptPatch.appendedEntries
			: collectAppendedTranscriptEntries(transcriptEntries, appendStartIndex);
	if (patchedEntriesByIndex === null || appendedTranscriptEntries.length === 0) {
		return null;
	}
	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	let transcriptEntryPatches: Map<string, TranscriptEntry> | null = null;
	let firstChangedRowIndex = Number.POSITIVE_INFINITY;

	for (const [index, nextTranscriptEntry] of patchedEntriesByIndex) {
		if (index < 0 || index >= appendStartIndex) {
			return null;
		}
		const previousTranscriptEntry = previous.transcriptEntries[index];
		if (
			previousTranscriptEntry === undefined ||
			previousTranscriptEntry.entryId !== nextTranscriptEntry.entryId
		) {
			return null;
		}

		const rowIndex = previous.sceneEntryRowIndex.get(nextTranscriptEntry.entryId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousSceneEntry = previous.conversation.entries[rowIndex];
		if (previousSceneEntry === undefined) {
			return null;
		}
		const nextSceneEntry = materializeTranscriptEntry(
			nextTranscriptEntry,
			input.graph,
			previous.operationIndex,
			isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
		);
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		if (areSceneEntriesEquivalent(previousSceneEntry, nextSceneEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextSceneEntry);
		firstChangedRowIndex = Math.min(firstChangedRowIndex, rowIndex);
	}

	const appendedSceneEntries: AgentPanelSceneEntryModel[] = [];
	for (const nextTranscriptEntry of appendedTranscriptEntries) {
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		appendedSceneEntries.push(
			materializeTranscriptEntry(
				nextTranscriptEntry,
				input.graph,
				previous.operationIndex,
				isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
			)
		);
	}

	const transcriptEntryById =
		transcriptEntryPatches === null
			? previous.transcriptEntryById
			: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches);

	if (entryPatches === null) {
		const transcriptSceneEntryCount = previous.transcriptEntries.length;
		const hasTrailingInteractionEntries =
			previous.conversation.entries.length > transcriptSceneEntryCount;
		const previousTrailingEntries = hasTrailingInteractionEntries
			? collectTrailingSceneEntries(previous.conversation.entries, transcriptSceneEntryCount)
			: [];
		const nextEntries = hasTrailingInteractionEntries
			? appendTranscriptEntriesBeforeTrailingInteractions(
					previous.conversation.entries,
					transcriptSceneEntryCount,
					appendedSceneEntries,
					previousTrailingEntries
				)
			: createAppendedSceneEntryArray(previous.conversation.entries, appendedSceneEntries);
		const sceneEntryRowIndex = hasTrailingInteractionEntries
			? createSplicedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					previousTrailingEntries,
					createAppendedInteractionTail(previousTrailingEntries, appendedSceneEntries),
					transcriptSceneEntryCount
				)
			: createAppendedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					appendedSceneEntries,
					transcriptSceneEntryCount
				);
		return {
			transcriptEntries,
			operations: input.graph.operations,
			operationIndex: previous.operationIndex,
			interactions: input.graph.interactions,
			interactionById: previous.interactionById,
			turnState: input.graph.turnState,
			activeStreamingTail: input.graph.activeStreamingTail,
			activity: input.graph.activity,
			transcriptEntryById,
			conversation: {
				entries: nextEntries,
				isStreaming: previous.conversation.isStreaming,
			},
			sceneEntryRowIndex,
		};
	}

	const previousSuffixEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		firstChangedRowIndex
	);
	const nextTrailingEntries =
		previous.conversation.entries.length > previous.transcriptEntries.length
			? filterTrailingEntriesAfterAppends(
					collectTrailingSceneEntries(
						previous.conversation.entries,
						previous.transcriptEntries.length
					),
					appendedSceneEntries
				)
			: [];
	const replacementEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = firstChangedRowIndex; index < transcriptEntries.length; index += 1) {
		const nextTranscriptEntry = transcriptEntries[index];
		if (nextTranscriptEntry === undefined) {
			continue;
		}
		replacementEntries.push(
			materializeTranscriptEntry(
				nextTranscriptEntry,
				input.graph,
				previous.operationIndex,
				isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
			)
		);
	}
	for (const trailingEntry of nextTrailingEntries) {
		replacementEntries.push(trailingEntry);
	}

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById,
		conversation: {
			entries: createInsertedSceneEntryArray(
				previous.conversation.entries,
				firstChangedRowIndex,
				replacementEntries,
				[]
			),
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousSuffixEntries,
			replacementEntries,
			firstChangedRowIndex
		),
	};
}

function materializeTranscriptAppendedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const transcriptPatch = getTranscriptEntryArrayPatch(transcriptEntries);
	const hasMarkedAppend =
		transcriptPatch !== undefined &&
		transcriptPatch.baseEntries === previous?.transcriptEntries &&
		transcriptPatch.appendedEntries !== null &&
		transcriptPatch.patchedEntriesByIndex === null;
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity) ||
		(!hasMarkedAppend && !isStableTranscriptAppend(previous.transcriptEntries, transcriptEntries))
	) {
		return null;
	}

	const appendStartIndex = previous.transcriptEntries.length;
	if (appendStartIndex === transcriptEntries.length) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById: previous.transcriptEntryById,
			activity: input.graph.activity,
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
	const transcriptEntryById = createAppendedTranscriptEntryIndex(
		previous.transcriptEntryById,
		transcriptEntries,
		appendStartIndex
	);

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const hasTrailingInteractionEntries =
		previous.conversation.entries.length > transcriptSceneEntryCount;
	const previousTrailingEntries = hasTrailingInteractionEntries
		? collectTrailingSceneEntries(previous.conversation.entries, transcriptSceneEntryCount)
		: [];
	const nextEntries = hasTrailingInteractionEntries
		? appendTranscriptEntriesBeforeTrailingInteractions(
				previous.conversation.entries,
				transcriptSceneEntryCount,
				appendedSceneEntries,
				previousTrailingEntries
			)
		: createAppendedSceneEntryArray(previous.conversation.entries, appendedSceneEntries);
	const sceneEntryRowIndex = hasTrailingInteractionEntries
		? createSplicedSceneEntryRowIndex(
				previous.sceneEntryRowIndex,
				previousTrailingEntries,
				createAppendedInteractionTail(previousTrailingEntries, appendedSceneEntries),
				transcriptSceneEntryCount
			)
		: createAppendedSceneEntryRowIndex(
				previous.sceneEntryRowIndex,
				appendedSceneEntries,
				transcriptSceneEntryCount
			);

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById,
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

function materializeTranscriptTruncatedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	if (
		transcriptEntries.length >= previous.transcriptEntries.length ||
		!isStableTranscriptTruncation(previous.transcriptEntries, transcriptEntries)
	) {
		return null;
	}

	const nextTranscriptSceneEntryCount = transcriptEntries.length;
	const previousTranscriptSceneEntryCount = previous.transcriptEntries.length;
	const previousTrailingEntries =
		previous.conversation.entries.length > previousTranscriptSceneEntryCount
			? collectTrailingSceneEntries(
					previous.conversation.entries,
					previousTranscriptSceneEntryCount
				)
			: [];
	const transcriptEntryById = createTruncatedTranscriptEntryIndex(
		previous.transcriptEntryById,
		previous.transcriptEntries,
		nextTranscriptSceneEntryCount
	);
	const conversationEntries =
		previousTrailingEntries.length === 0
			? createTruncatedSceneEntryArray(
					previous.conversation.entries,
					nextTranscriptSceneEntryCount
				)
			: createInsertedSceneEntryArray(
					previous.conversation.entries,
					nextTranscriptSceneEntryCount,
					[],
					previousTrailingEntries
				);
	const deletedSceneEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		nextTranscriptSceneEntryCount
	);
	const sceneEntryRowIndex =
		previousTrailingEntries.length === 0
			? createTruncatedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					deletedSceneEntries
				)
			: createSplicedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					deletedSceneEntries,
					previousTrailingEntries,
					nextTranscriptSceneEntryCount
				);

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById,
		conversation: {
			entries: conversationEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}

function appendTranscriptEntriesBeforeTrailingInteractions(
	previousEntries: readonly AgentPanelSceneEntryModel[],
	transcriptSceneEntryCount: number,
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[],
	previousTrailingEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const nextTrailingEntries = filterTrailingEntriesAfterAppends(
		previousTrailingEntries,
		appendedSceneEntries
	);
	return createInsertedSceneEntryArray(
		previousEntries,
		transcriptSceneEntryCount,
		appendedSceneEntries,
		nextTrailingEntries
	);
}

function collectTrailingSceneEntries(
	entries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): readonly AgentPanelSceneEntryModel[] {
	const trailingEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			trailingEntries.push(entry);
		}
	}
	return trailingEntries;
}

function createAppendedInteractionTail(
	previousTrailingEntries: readonly AgentPanelSceneEntryModel[],
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const nextTrailingEntries = filterTrailingEntriesAfterAppends(
		previousTrailingEntries,
		appendedSceneEntries
	);
	return createAppendedSceneEntryArray(appendedSceneEntries, nextTrailingEntries);
}

function filterTrailingEntriesAfterAppends(
	previousTrailingEntries: readonly AgentPanelSceneEntryModel[],
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	if (previousTrailingEntries.length === 0) {
		return previousTrailingEntries;
	}

	const appendedIds = new Set<string>();
	for (const entry of appendedSceneEntries) {
		appendedIds.add(entry.id);
	}

	if (appendedIds.size === 0) {
		return previousTrailingEntries;
	}

	const trailingEntries: AgentPanelSceneEntryModel[] = [];
	for (const entry of previousTrailingEntries) {
		if (!appendedIds.has(entry.id)) {
			trailingEntries.push(entry);
		}
	}
	return trailingEntries;
}

function materializeInteractionPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.transcriptEntries !== input.graph.transcriptSnapshot.entries ||
		previous.operations !== input.graph.operations ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		)
	) {
		return null;
	}

	const interactionArrayPatch = getInteractionSnapshotArrayPatch(input.graph.interactions);
	if (interactionArrayPatch?.baseInteractions === previous.interactions) {
		const patched = materializeMarkedInteractionPatchedConversation(
			previous,
			input,
			interactionArrayPatch.patchedInteractionsByIndex,
			interactionArrayPatch.appendedInteractions
		);
		if (patched !== null) {
			return patched;
		}
	}
	const stableInteractionAppend = materializeStableInteractionAppendedConversation(
		previous,
		input
	);
	if (stableInteractionAppend !== null) {
		return stableInteractionAppend;
	}
	const stableInteractionTruncation = materializeStableInteractionTruncatedConversation(
		previous,
		input
	);
	if (stableInteractionTruncation !== null) {
		return stableInteractionTruncation;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const nextInteractionEntries = materializeVisibleInteractionEntries(
		input.graph,
		previous.sceneEntryRowIndex
	);
	const previousInteractionEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (areSceneEntryListsEquivalent(previousInteractionEntries, nextInteractionEntries)) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById: buildInteractionIndex(input.graph.interactions),
			activity: input.graph.activity,
		};
	}

	const nextEntries = createInsertedSceneEntryArray(
		previous.conversation.entries,
		transcriptSceneEntryCount,
		nextInteractionEntries,
		[]
	);
	const sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
		previous.sceneEntryRowIndex,
		previousInteractionEntries,
		nextInteractionEntries,
		transcriptSceneEntryCount
	);
	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
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

function materializeStableInteractionAppendedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput
): CachedConversationState | null {
	if (input.graph.interactions.length <= previous.interactions.length) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}

	const previousVisibleEntry: AgentPanelSceneEntryModel | null =
		previousVisibleEntries[0] ?? null;
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	if (nextBlockingInteractionId === previousBlockingInteractionId) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById: buildInteractionIndex(input.graph.interactions),
			activity: input.graph.activity,
		};
	}
	if (nextBlockingInteractionId === null) {
		return null;
	}

	const appendedInteractions = collectAppendedInteractions(
		input.graph.interactions,
		previous.interactions.length
	);
	let nextVisibleEntry: AgentPanelSceneEntryModel | null = null;
	for (const interaction of appendedInteractions) {
		if (interaction.id !== nextBlockingInteractionId) {
			continue;
		}
		nextVisibleEntry = questionInteractionToSceneEntry(interaction, input.graph);
		break;
	}
	if (nextVisibleEntry === null) {
		return null;
	}

	if (
		previousVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id &&
		areSceneEntriesEquivalent(previousVisibleEntry, nextVisibleEntry)
	) {
		return {
			...previous,
			interactions: input.graph.interactions,
			activity: input.graph.activity,
		};
	}

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null) {
		nextEntries = createAppendedSceneEntryArray(previous.conversation.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			previous.conversation.entries.length
		);
	} else {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			[nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
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

function materializeStableInteractionTruncatedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput
): CachedConversationState | null {
	if (input.graph.interactions.length >= previous.interactions.length) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}

	const previousVisibleEntry: AgentPanelSceneEntryModel | null =
		previousVisibleEntries[0] ?? null;
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	if (nextBlockingInteractionId === previousBlockingInteractionId) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById: buildInteractionIndex(input.graph.interactions),
			activity: input.graph.activity,
		};
	}
	if (nextBlockingInteractionId !== null) {
		return null;
	}
	if (previousVisibleEntry === null) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById: buildInteractionIndex(input.graph.interactions),
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: createInsertedSceneEntryArray(
				previous.conversation.entries,
				transcriptSceneEntryCount,
				[],
				[]
			),
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		),
	};
}

function materializeMarkedInteractionPatchedConversation(
	previous: CachedConversationState,
	input: CachedConversationInput,
	patchedInteractionsByIndex: ReadonlyMap<number, InteractionSnapshot> | null,
	appendedInteractions: readonly InteractionSnapshot[] | null
): CachedConversationState | null {
	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}
	const previousVisibleEntry: AgentPanelSceneEntryModel | null =
		previousVisibleEntries[0] ?? null;
	let nextVisibleEntry: AgentPanelSceneEntryModel | null = previousVisibleEntry;
	let visibleEntryChanged = false;

	if (patchedInteractionsByIndex !== null) {
		for (const [index, interaction] of patchedInteractionsByIndex) {
			const previousInteraction = previous.interactions[index];
			if (previousInteraction === undefined || previousInteraction.id !== interaction.id) {
				return null;
			}
			const rowId = interactionSceneEntryId(interaction.id);
			const nextEntry = questionInteractionToSceneEntry(interaction, input.graph);
			if (nextEntry === null) {
				if (previousVisibleEntry?.id !== rowId) {
					continue;
				}
				nextVisibleEntry = null;
				visibleEntryChanged = true;
				continue;
			}
			if (
				nextVisibleEntry !== null &&
				nextVisibleEntry.id !== rowId &&
				previousVisibleEntry?.id !== rowId
			) {
				return null;
			}
			if (
				previousVisibleEntry !== null &&
				previousVisibleEntry.id === rowId &&
				areSceneEntriesEquivalent(previousVisibleEntry, nextEntry)
			) {
				continue;
			}
			nextVisibleEntry = nextEntry;
			visibleEntryChanged = true;
		}
	}

	if (appendedInteractions !== null) {
		for (const interaction of appendedInteractions) {
			const nextEntry = questionInteractionToSceneEntry(interaction, input.graph);
			if (nextEntry === null) {
				continue;
			}
			if (nextVisibleEntry !== null && nextVisibleEntry.id !== nextEntry.id) {
				return null;
			}
			if (
				previousVisibleEntry !== null &&
				previousVisibleEntry.id === nextEntry.id &&
				areSceneEntriesEquivalent(previousVisibleEntry, nextEntry)
			) {
				continue;
			}
			nextVisibleEntry = nextEntry;
			visibleEntryChanged = true;
		}
	}

	if (!visibleEntryChanged) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById: buildInteractionIndex(input.graph.interactions),
			activity: input.graph.activity,
		};
	}

	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			interactions: input.graph.interactions,
			interactionById: buildInteractionIndex(input.graph.interactions),
			activity: input.graph.activity,
		};
	}

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(previous.conversation.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			previous.conversation.entries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			[],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		);
	} else if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id
	) {
		nextEntries = createPatchedSceneEntryArray(
			previous.conversation.entries,
			new Map([[transcriptSceneEntryCount, nextVisibleEntry]])
		);
		sceneEntryRowIndex = previous.sceneEntryRowIndex;
	} else {
		nextEntries = createInsertedSceneEntryArray(
			previous.conversation.entries,
			transcriptSceneEntryCount,
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousVisibleEntry === null ? [] : [previousVisibleEntry],
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
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

function interactionSceneEntryId(interactionId: string): string {
	return `interaction:${interactionId}`;
}

function materializeVisibleInteractionEntries(
	graph: AgentPanelCanonicalSource,
	sceneEntryRowIndex: ReadonlyMap<string, number>
): AgentPanelSceneEntryModel[] {
	const entries: AgentPanelSceneEntryModel[] = [];
	for (const interaction of graph.interactions) {
		const entry = questionInteractionToSceneEntry(interaction, graph);
		if (entry === null || sceneEntryRowIndex.has(entry.id)) {
			continue;
		}
		entries.push(entry);
	}
	return entries;
}

function areSceneEntryListsEquivalent(
	left: readonly AgentPanelSceneEntryModel[],
	right: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((entry, index) => areSceneEntriesEquivalent(entry, right[index]));
}

function createSplicedSceneEntryRowIndex(
	rowIndex: ReadonlyMap<string, number>,
	previousEntries: readonly AgentPanelSceneEntryModel[],
	nextEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	const deletedKeys = new Set<string>();
	for (const entry of previousEntries) {
		deletedKeys.add(entry.id);
	}
	return createPatchedReadonlyMap(
		rowIndex,
		createSceneEntryRowIndexForRange(nextEntries, startIndex),
		deletedKeys
	);
}

function createTruncatedSceneEntryRowIndex(
	rowIndex: ReadonlyMap<string, number>,
	deletedEntries: readonly AgentPanelSceneEntryModel[]
): ReadonlyMap<string, number> {
	const deletedKeys = new Set<string>();
	for (const entry of deletedEntries) {
		deletedKeys.add(entry.id);
	}
	return createPatchedReadonlyMap(rowIndex, new Map(), deletedKeys);
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

function isStableTranscriptPatchAndAppend(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): boolean {
	if (nextEntries.length <= previousEntries.length) {
		return false;
	}

	let sawPatchedPrefixEntry = false;
	for (let index = 0; index < previousEntries.length; index += 1) {
		const previousEntry = previousEntries[index];
		const nextEntry = nextEntries[index];
		if (previousEntry === undefined || nextEntry === undefined) {
			return false;
		}
		if (previousEntry.entryId !== nextEntry.entryId) {
			return false;
		}
		if (previousEntry !== nextEntry) {
			sawPatchedPrefixEntry = true;
		}
	}
	return sawPatchedPrefixEntry;
}

function isStableTranscriptTruncation(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): boolean {
	if (nextEntries.length >= previousEntries.length) {
		return false;
	}

	for (let index = 0; index < nextEntries.length; index += 1) {
		if (nextEntries[index] !== previousEntries[index]) {
			return false;
		}
	}

	return true;
}

function collectStableTranscriptPatchedEntriesByIndex(
	previousEntries: readonly TranscriptEntry[],
	nextEntries: readonly TranscriptEntry[]
): ReadonlyMap<number, TranscriptEntry> | null {
	let patches: Map<number, TranscriptEntry> | null = null;
	for (let index = 0; index < previousEntries.length; index += 1) {
		const previousEntry = previousEntries[index];
		const nextEntry = nextEntries[index];
		if (previousEntry === undefined || nextEntry === undefined) {
			return null;
		}
		if (previousEntry.entryId !== nextEntry.entryId) {
			return null;
		}
		if (previousEntry === nextEntry) {
			continue;
		}
		patches ??= new Map<number, TranscriptEntry>();
		patches.set(index, nextEntry);
	}
	return patches;
}

function collectAppendedTranscriptEntries(
	entries: readonly TranscriptEntry[],
	startIndex: number
): readonly TranscriptEntry[] {
	const appendedEntries: TranscriptEntry[] = [];
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			appendedEntries.push(entry);
		}
	}
	return appendedEntries;
}

function collectAppendedInteractions(
	interactions: readonly InteractionSnapshot[],
	startIndex: number
): readonly InteractionSnapshot[] {
	const appendedInteractions: InteractionSnapshot[] = [];
	for (let index = startIndex; index < interactions.length; index += 1) {
		const interaction = interactions[index];
		if (interaction !== undefined) {
			appendedInteractions.push(interaction);
		}
	}
	return appendedInteractions;
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
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		)
	) {
		return null;
	}

	const operationPatch =
		applyStableMarkedOperationIndexPatchInPlace(
			previous.operations,
			input.graph.operations,
			previous.operationIndex
		) ??
		applyOperationIndexPatch(
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
			activity: input.graph.activity,
		};
	}

	const affectedEntryIds =
		operationPatch.affectedEntryIds ??
		collectAffectedTranscriptEntryIds(previous.operationIndex, operationIndex, changedOperationIds);
	if (affectedEntryIds.size === 0) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
		};
	}

	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
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
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextEntry);
	}

	if (entryPatches === null) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
		};
	}

	const blockingInteractionPatched = materializeBlockingInteractionActivityChange(
		previous,
		input,
		operationIndex,
		entryPatches
	);
	if (blockingInteractionPatched !== null) {
		return blockingInteractionPatched;
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: {
			entries: createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

function materializeBlockingInteractionActivityChange(
	previous: CachedConversationState,
	input: CachedConversationInput,
	operationIndex: OperationIndex,
	entryPatches: ReadonlyMap<number, AgentPanelSceneEntryModel>
): CachedConversationState | null {
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	if (previousBlockingInteractionId === nextBlockingInteractionId) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}

	const previousVisibleEntry = previousVisibleEntries[0] ?? null;
	const nextVisibleInteraction =
		nextBlockingInteractionId === null
			? null
			: previous.interactionById.get(nextBlockingInteractionId) ?? null;
	if (nextBlockingInteractionId !== null && nextVisibleInteraction === null) {
		return null;
	}

	const nextVisibleEntry =
		nextVisibleInteraction === null
			? null
			: questionInteractionToSceneEntry(nextVisibleInteraction, input.graph);
	const baseEntries = createPatchedSceneEntryArray(previous.conversation.entries, entryPatches);

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
			conversation: {
				entries: baseEntries,
				isStreaming: previous.conversation.isStreaming,
			},
		};
	}
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(baseEntries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			baseEntries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(baseEntries, transcriptSceneEntryCount, [], []);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		);
	} else if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id
	) {
		nextEntries = createPatchedSceneEntryArray(
			baseEntries,
			new Map([[transcriptSceneEntryCount, nextVisibleEntry]])
		);
		sceneEntryRowIndex = previous.sceneEntryRowIndex;
	} else {
		nextEntries = createInsertedSceneEntryArray(
			baseEntries,
			transcriptSceneEntryCount,
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousVisibleEntry === null ? [] : [previousVisibleEntry],
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
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

function addSceneEntryPatch(
	patches: Map<number, AgentPanelSceneEntryModel> | null,
	rowIndex: number,
	entry: AgentPanelSceneEntryModel
): Map<number, AgentPanelSceneEntryModel> {
	const nextPatches = patches ?? new Map<number, AgentPanelSceneEntryModel>();
	nextPatches.set(rowIndex, entry);
	return nextPatches;
}

function createPatchedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	entryPatches: ReadonlyMap<number, AgentPanelSceneEntryModel>
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(baseEntries.length);
	const entries = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseEntries.length; index += 1) {
						yield entryPatches.get(index) ?? baseEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return entryPatches.get(index) ?? baseEntries[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < baseEntries.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < baseEntries.length) {
				return {
					configurable: true,
					enumerable: true,
					value: entryPatches.get(index) ?? baseEntries[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	markAgentPanelSceneEntryArrayPatch(entries, {
		baseSceneEntries: baseEntries,
		entries: Array.from(entryPatches.values()),
		entriesByIndex: entryPatches,
	});
	return entries;
}

function createAppendedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	appendedEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const entries = createSceneEntryArrayView(baseEntries.length + appendedEntries.length, (index) =>
		index < baseEntries.length ? baseEntries[index] : appendedEntries[index - baseEntries.length]
	);
	markAgentPanelSceneEntryArrayAppendPatch(entries, {
		baseSceneEntries: baseEntries,
		appendedEntries,
	});
	return entries;
}

function createTruncatedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	length: number
): readonly AgentPanelSceneEntryModel[] {
	const entries = createSceneEntryArrayView(length, (index) => baseEntries[index]);
	markAgentPanelSceneEntryArrayTruncation(entries, {
		baseSceneEntries: baseEntries,
		length,
	});
	return entries;
}

function createInsertedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	insertIndex: number,
	insertedEntries: readonly AgentPanelSceneEntryModel[],
	trailingEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const entries = createSceneEntryArrayView(
		insertIndex + insertedEntries.length + trailingEntries.length,
		(index) => {
			if (index < insertIndex) {
				return baseEntries[index];
			}
			const insertedIndex = index - insertIndex;
			if (insertedIndex < insertedEntries.length) {
				return insertedEntries[insertedIndex];
			}
			return trailingEntries[insertedIndex - insertedEntries.length];
		}
	);
	markAgentPanelSceneEntryArraySplicePatch(entries, {
		baseSceneEntries: baseEntries,
		startIndex: insertIndex,
		insertedEntries,
		trailingEntries,
	});
	return entries;
}

function createSceneEntryArrayView(
	length: number,
	selectEntry: (index: number) => AgentPanelSceneEntryModel | undefined
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectEntry(index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectEntry(index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectEntry(index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
}

function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

function areSceneEntriesEquivalent(
	left: AgentPanelSceneEntryModel,
	right: AgentPanelSceneEntryModel
): boolean {
	return areJsonLikeValuesEquivalent(left, right);
}

function areActiveStreamingTailsEquivalent(
	left: AgentPanelCanonicalSource["activeStreamingTail"],
	right: AgentPanelCanonicalSource["activeStreamingTail"]
): boolean {
	if (left === right) {
		return true;
	}
	if (left === null || right === null) {
		return false;
	}
	return left.rowId === right.rowId && left.contentKind === right.contentKind;
}

function areActivitiesEquivalent(
	left: AgentPanelCanonicalSource["activity"],
	right: AgentPanelCanonicalSource["activity"]
): boolean {
	return (
		left === right ||
		(left.kind === right.kind &&
			left.activeOperationCount === right.activeOperationCount &&
			left.activeSubagentCount === right.activeSubagentCount &&
			left.dominantOperationId === right.dominantOperationId &&
			left.blockingInteractionId === right.blockingInteractionId)
	);
}

function areActivitiesCompatibleForConversationPatch(
	left: AgentPanelCanonicalSource["activity"],
	right: AgentPanelCanonicalSource["activity"]
): boolean {
	return left.blockingInteractionId === right.blockingInteractionId;
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
): OperationIndexPatchResult | null {
	if (nextOperations.length < previousOperations.length) {
		return null;
	}

	const operationArrayPatch = getOperationSnapshotArrayPatch(nextOperations);
	if (operationArrayPatch?.baseOperations === previousOperations) {
		return applyMarkedOperationIndexPatch(
			previousOperations,
			previousIndex,
			operationArrayPatch.patchedOperationsByIndex,
			operationArrayPatch.appendedOperations
		);
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

function applyStableMarkedOperationIndexPatchInPlace(
	previousOperations: readonly OperationSnapshot[],
	nextOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex
): OperationIndexPatchResult | null {
	const operationArrayPatch = getOperationSnapshotArrayPatch(nextOperations);
	if (
		operationArrayPatch?.baseOperations !== previousOperations ||
		operationArrayPatch.patchedOperationsByIndex === null
	) {
		return null;
	}

	const patchedOperationIds = new Set<string>();
	const changedOperationIds = new Set<string>();
	const operationsToPatch: OperationSnapshot[] = [];
	for (const [index, nextOperation] of operationArrayPatch.patchedOperationsByIndex) {
		const previousOperation = previousOperations[index];
		if (previousOperation === undefined || previousOperation.id !== nextOperation.id) {
			return null;
		}
		if (previousOperation === nextOperation) {
			continue;
		}
		if (!canPatchOperationIndexInPlace(previousOperation, nextOperation)) {
			return null;
		}
		patchedOperationIds.add(nextOperation.id);
		changedOperationIds.add(nextOperation.id);
		operationsToPatch.push(nextOperation);
	}

	const appendedOperations = operationArrayPatch.appendedOperations;
	const hasAppendedOperations = appendedOperations !== null && appendedOperations.length > 0;
	if (changedOperationIds.size === 0 && !hasAppendedOperations) {
		return {
			operationIndex: previousIndex,
			changedOperationIds,
			affectedEntryIds: new Set(),
		};
	}

	const affectedEntryIds = collectAffectedTranscriptEntryIds(
		previousIndex,
		previousIndex,
		patchedOperationIds
	);
	const patchedOperationById = createOperationPatchMap(operationsToPatch);
	const patchedOperationByTranscriptEntryId =
		createTranscriptLinkedOperationPatchMap(operationsToPatch);
	const patchedOperationIndex =
		changedOperationIds.size === 0
			? previousIndex
			: createPatchedOperationIndex(
					previousIndex,
					patchedOperationById,
					patchedOperationByTranscriptEntryId
				);

	let operationIndex = patchedOperationIndex;
	if (hasAppendedOperations) {
		operationIndex = appendOperationIndex(patchedOperationIndex, appendedOperations);
		const appendedOperationIds = new Set<string>();
		for (const operation of appendedOperations) {
			appendedOperationIds.add(operation.id);
			changedOperationIds.add(operation.id);
		}
		const appendedAffectedEntryIds = collectAffectedTranscriptEntryIds(
			previousIndex,
			operationIndex,
			appendedOperationIds
		);
		for (const entryId of appendedAffectedEntryIds) {
			affectedEntryIds.add(entryId);
		}
	}

	return {
		operationIndex,
		changedOperationIds,
		affectedEntryIds,
	};
}

function canPatchOperationIndexInPlace(
	previousOperation: OperationSnapshot,
	nextOperation: OperationSnapshot
): boolean {
	return (
		areJsonLikeValuesEquivalent(previousOperation.source_link, nextOperation.source_link) &&
		areStringListsEquivalent(
			previousOperation.child_operation_ids,
			nextOperation.child_operation_ids
		)
	);
}

function areStringListsEquivalent(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyMarkedOperationIndexPatch(
	previousOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex,
	patchedOperationsByIndex: ReadonlyMap<number, OperationSnapshot> | null,
	appendedOperations: readonly OperationSnapshot[] | null
): OperationIndexPatchResult | null {
	let operationIndex: OperationIndex | null = null;
	const changedOperationIds = new Set<string>();

	if (patchedOperationsByIndex !== null) {
		for (const [index, nextOperation] of patchedOperationsByIndex) {
			const previousOperation = previousOperations[index];
			if (previousOperation === undefined || previousOperation.id !== nextOperation.id) {
				return null;
			}
			if (previousOperation === nextOperation) {
				continue;
			}

			operationIndex ??= cloneOperationIndex(previousIndex);
			replaceOperationInIndex(operationIndex, previousOperation, nextOperation);
			changedOperationIds.add(nextOperation.id);
		}
	}

	if (appendedOperations !== null && appendedOperations.length > 0) {
		if (operationIndex === null) {
			operationIndex = appendOperationIndex(previousIndex, appendedOperations);
		} else {
			for (const operation of appendedOperations) {
				addOperationToIndex(operationIndex, operation);
			}
		}
		for (const operation of appendedOperations) {
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
		parentsByChildOperationId: new Map(index.parentsByChildOperationId),
	};
}

function appendOperationIndex(
	index: OperationIndex,
	appendedOperations: readonly OperationSnapshot[]
): OperationIndex {
	return {
		byOperationId: new AppendedOperationByIdMap(index.byOperationId, appendedOperations),
		byTranscriptSourceEntryId: new AppendedOperationByTranscriptEntryMap(
			index.byTranscriptSourceEntryId,
			appendedOperations
		),
		parentsByChildOperationId: new AppendedParentsByChildOperationMap(
			index.parentsByChildOperationId,
			appendedOperations
		),
	};
}

function createOperationPatchMap(
	operations: readonly OperationSnapshot[]
): ReadonlyMap<string, OperationSnapshot> {
	const patches = new Map<string, OperationSnapshot>();
	for (const operation of operations) {
		patches.set(operation.id, operation);
	}
	return patches;
}

function createTranscriptLinkedOperationPatchMap(
	operations: readonly OperationSnapshot[]
): ReadonlyMap<string, OperationSnapshot> {
	const patches = new Map<string, OperationSnapshot>();
	for (const operation of operations) {
		if (operation.source_link.kind === "transcript_linked") {
			patches.set(operation.source_link.entry_id, operation);
		}
	}
	return patches;
}

function createPatchedOperationIndex(
	index: OperationIndex,
	operationPatchesById: ReadonlyMap<string, OperationSnapshot>,
	operationPatchesByTranscriptEntryId: ReadonlyMap<string, OperationSnapshot>
): OperationIndex {
	return {
		byOperationId: new PatchedOperationMap(index.byOperationId, operationPatchesById),
		byTranscriptSourceEntryId: new PatchedOperationMap(
			index.byTranscriptSourceEntryId,
			operationPatchesByTranscriptEntryId
		),
		parentsByChildOperationId: index.parentsByChildOperationId,
	};
}

class PatchedOperationMap extends Map<string, OperationSnapshot> {
	constructor(
		private readonly base: Map<string, OperationSnapshot>,
		private readonly patches: ReadonlyMap<string, OperationSnapshot>
	) {
		super();
	}

	override get size(): number {
		let size = this.base.size;
		for (const key of this.patches.keys()) {
			if (!this.base.has(key) && !super.has(key)) {
				size += 1;
			}
		}
		return size + super.size;
	}

	override get(key: string): OperationSnapshot | undefined {
		const local = super.get(key);
		if (local !== undefined) {
			return local;
		}
		return this.patches.get(key) ?? this.base.get(key);
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot]> {
		const yieldedKeys = new Set<string>();
		for (const [key, value] of this.patches.entries()) {
			if (!super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const [key, value] of this.base.entries()) {
			if (!yieldedKeys.has(key) && !super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot]> {
		return this.entries();
	}
}

class AppendedOperationByIdMap extends Map<string, OperationSnapshot> {
	constructor(
		private readonly base: Map<string, OperationSnapshot>,
		private readonly appendedOperations: readonly OperationSnapshot[]
	) {
		super();
	}

	override get size(): number {
		let size = this.base.size;
		for (const operation of this.appendedOperations) {
			if (!this.base.has(operation.id) && !super.has(operation.id)) {
				size += 1;
			}
		}
		return size + super.size;
	}

	override get(key: string): OperationSnapshot | undefined {
		const local = super.get(key);
		if (local !== undefined) {
			return local;
		}
		for (const operation of this.appendedOperations) {
			if (operation.id === key) {
				return operation;
			}
		}
		return this.base.get(key);
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot]> {
		const yieldedKeys = new Set<string>();
		for (const [key, value] of this.base.entries()) {
			if (!super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const operation of this.appendedOperations) {
			if (!yieldedKeys.has(operation.id) && !super.has(operation.id)) {
				yieldedKeys.add(operation.id);
				yield [operation.id, operation];
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot]> {
		return this.entries();
	}
}

class AppendedOperationByTranscriptEntryMap extends Map<string, OperationSnapshot> {
	constructor(
		private readonly base: Map<string, OperationSnapshot>,
		private readonly appendedOperations: readonly OperationSnapshot[]
	) {
		super();
	}

	override get size(): number {
		let size = this.base.size;
		for (const operation of this.appendedOperations) {
			if (
				operation.source_link.kind === "transcript_linked" &&
				!this.base.has(operation.source_link.entry_id) &&
				!super.has(operation.source_link.entry_id)
			) {
				size += 1;
			}
		}
		return size + super.size;
	}

	override get(key: string): OperationSnapshot | undefined {
		const local = super.get(key);
		if (local !== undefined) {
			return local;
		}
		for (const operation of this.appendedOperations) {
			if (
				operation.source_link.kind === "transcript_linked" &&
				operation.source_link.entry_id === key
			) {
				return operation;
			}
		}
		return this.base.get(key);
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot]> {
		const yieldedKeys = new Set<string>();
		for (const [key, value] of this.base.entries()) {
			if (!super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const operation of this.appendedOperations) {
			if (
				operation.source_link.kind === "transcript_linked" &&
				!yieldedKeys.has(operation.source_link.entry_id) &&
				!super.has(operation.source_link.entry_id)
			) {
				yieldedKeys.add(operation.source_link.entry_id);
				yield [operation.source_link.entry_id, operation];
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot]> {
		return this.entries();
	}
}

class AppendedParentsByChildOperationMap extends Map<string, OperationSnapshot[]> {
	private appendedParentsByChildOperationId: Map<string, OperationSnapshot[]> | null = null;

	constructor(
		private readonly base: Map<string, OperationSnapshot[]>,
		private readonly appendedOperations: readonly OperationSnapshot[]
	) {
		super();
	}

	override get(key: string): OperationSnapshot[] | undefined {
		const local = super.get(key);
		const baseParents = this.base.get(key);
		const appendedParents = this.getAppendedParentsByChildOperationId().get(key) ?? [];
		if (local === undefined && appendedParents.length === 0) {
			return baseParents;
		}
		return [...(baseParents ?? []), ...(local ?? []), ...appendedParents];
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot[]]> {
		const yieldedKeys = new Set<string>();
		for (const [key] of this.base.entries()) {
			const parents = this.get(key);
			if (parents !== undefined) {
				yieldedKeys.add(key);
				yield [key, parents];
			}
		}
		for (const operation of this.appendedOperations) {
			for (const childOperationId of operation.child_operation_ids) {
				if (!yieldedKeys.has(childOperationId)) {
					const parents = this.get(childOperationId);
					if (parents !== undefined) {
						yieldedKeys.add(childOperationId);
						yield [childOperationId, parents];
					}
				}
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot[]]> {
		return this.entries();
	}

	private getAppendedParentsByChildOperationId(): Map<string, OperationSnapshot[]> {
		if (this.appendedParentsByChildOperationId !== null) {
			return this.appendedParentsByChildOperationId;
		}

		const next = new Map<string, OperationSnapshot[]>();
		for (const operation of this.appendedOperations) {
			for (const childOperationId of operation.child_operation_ids) {
				const parents = next.get(childOperationId);
				if (parents === undefined) {
					next.set(childOperationId, [operation]);
					continue;
				}
				parents.push(operation);
			}
		}
		this.appendedParentsByChildOperationId = next;
		return next;
	}
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
		index.parentsByChildOperationId.set(childOperationId, [...parents, operation]);
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

function buildInteractionIndex(
	interactions: readonly InteractionSnapshot[]
): Map<string, InteractionSnapshot> {
	const byInteractionId = new Map<string, InteractionSnapshot>();
	for (const interaction of interactions) {
		byInteractionId.set(interaction.id, interaction);
	}
	return byInteractionId;
}

function appendTranscriptEntryIndexFromRange(
	byEntryId: ReadonlyMap<string, TranscriptEntry>,
	entries: readonly TranscriptEntry[],
	startIndex: number
): ReadonlyMap<string, TranscriptEntry> {
	const appendedEntries = new Map<string, TranscriptEntry>();
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			appendedEntries.set(entry.entryId, entry);
		}
	}
	return createPatchedReadonlyMap(byEntryId, appendedEntries);
}

function createAppendedTranscriptEntryIndex(
	byEntryId: ReadonlyMap<string, TranscriptEntry>,
	entries: readonly TranscriptEntry[],
	startIndex: number
): ReadonlyMap<string, TranscriptEntry> {
	return appendTranscriptEntryIndexFromRange(byEntryId, entries, startIndex);
}

function createTruncatedTranscriptEntryIndex(
	byEntryId: ReadonlyMap<string, TranscriptEntry>,
	previousEntries: readonly TranscriptEntry[],
	length: number
): ReadonlyMap<string, TranscriptEntry> {
	const deletedKeys = new Set<string>();
	for (let index = length; index < previousEntries.length; index += 1) {
		const entry = previousEntries[index];
		if (entry !== undefined) {
			deletedKeys.add(entry.entryId);
		}
	}
	return createPatchedReadonlyMap(byEntryId, new Map(), deletedKeys);
}

class PatchedReadonlyMap<K, V> implements ReadonlyMap<K, V> {
	readonly [Symbol.toStringTag] = "PatchedReadonlyMap";

	constructor(
		private readonly base: ReadonlyMap<K, V>,
		private readonly patches: ReadonlyMap<K, V>,
		private readonly deletedKeys: ReadonlySet<K> = new Set<K>()
	) {}

	get size(): number {
		let size = this.base.size;
		for (const key of this.deletedKeys) {
			if (this.base.has(key) && !this.patches.has(key)) {
				size -= 1;
			}
		}
		for (const key of this.patches.keys()) {
			if (!this.base.has(key)) {
				size += 1;
			}
		}
		return size;
	}

	get(key: K): V | undefined {
		if (this.patches.has(key)) {
			return this.patches.get(key);
		}
		if (this.deletedKeys.has(key)) {
			return undefined;
		}
		return this.base.get(key);
	}

	has(key: K): boolean {
		return this.patches.has(key) || (!this.deletedKeys.has(key) && this.base.has(key));
	}

	forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	*entries(): MapIterator<[K, V]> {
		const patchedKeys = new Set<K>();
		for (const [key, value] of this.patches.entries()) {
			patchedKeys.add(key);
			yield [key, value];
		}
		for (const [key, value] of this.base.entries()) {
			if (!patchedKeys.has(key) && !this.deletedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	*keys(): MapIterator<K> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	*values(): MapIterator<V> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	[Symbol.iterator](): MapIterator<[K, V]> {
		return this.entries();
	}
}

function createPatchedReadonlyMap<K, V>(
	base: ReadonlyMap<K, V>,
	patches: ReadonlyMap<K, V>,
	deletedKeys: ReadonlySet<K> = new Set<K>()
): ReadonlyMap<K, V> {
	return patches.size === 0 && deletedKeys.size === 0
		? base
		: new PatchedReadonlyMap(base, patches, deletedKeys);
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

function createAppendedSceneEntryRowIndex(
	byEntryId: ReadonlyMap<string, number>,
	appendedEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	return createPatchedReadonlyMap(
		byEntryId,
		createSceneEntryRowIndexForRange(appendedEntries, startIndex)
	);
}

function createSceneEntryRowIndexForRange(
	entries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	const indexByEntryId = new Map<string, number>();
	entries.forEach((entry, index) => {
		indexByEntryId.set(entry.id, startIndex + index);
	});
	return indexByEntryId;
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
