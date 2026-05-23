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

	for (const operation of operations) {
		byOperationId.set(operation.id, operation);
		if (operation.source_link.kind === "transcript_linked") {
			byTranscriptSourceEntryId.set(operation.source_link.entry_id, operation);
		}
	}

	return {
		byOperationId,
		byTranscriptSourceEntryId,
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

	const transcriptLinkedEntryIds = Array.from(index.byTranscriptSourceEntryId.keys()).slice(0, 40);
	const operationSummaries = graph.operations.slice(0, 40).map((operation) => {
		return {
			id: operation.id,
			toolCallId: operation.tool_call_id,
			name: operation.name,
			title: operation.title,
			state: operation.operation_state,
			sourceLink: operation.source_link,
		};
	});

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
		toolTranscriptEntryCount: graph.transcriptSnapshot.entries.filter(
			(candidate) => candidate.role === "tool"
		).length,
		operationCount: graph.operations.length,
		transcriptLinkedEntryIds,
		operationSummaries,
	});
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

		return materializeOperationEntry(
			operation,
			graph,
			index,
			new Set<string>(),
			entry.entryId
		);
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
		!isStableTranscriptAppend(
			previous.transcriptEntries,
			input.graph.transcriptSnapshot.entries
		)
	) {
		return null;
	}

	const appendedTranscriptEntries = input.graph.transcriptSnapshot.entries.slice(
		previous.transcriptEntries.length
	);
	if (appendedTranscriptEntries.length === 0) {
		return {
			...previous,
			transcriptEntries: input.graph.transcriptSnapshot.entries,
			transcriptEntryById: previous.transcriptEntryById,
		};
	}

	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const appendedSceneEntries = appendedTranscriptEntries.map((entry) =>
		materializeTranscriptEntry(
			entry,
			input.graph,
			previous.operationIndex,
			isRunning && entry.entryId === liveAssistantEntryId
		)
	);
	const appendedIds = new Set(appendedSceneEntries.map((entry) => entry.id));
	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const existingTranscriptEntries = previous.conversation.entries.slice(
		0,
		transcriptSceneEntryCount
	);
	const trailingInteractionEntries = previous.conversation.entries
		.slice(transcriptSceneEntryCount)
		.filter((entry) => !appendedIds.has(entry.id));
	const nextEntries = existingTranscriptEntries
		.concat(appendedSceneEntries)
		.concat(trailingInteractionEntries);
	const sceneEntryRowIndex =
		trailingInteractionEntries.length === 0
			? appendSceneEntryRowIndex(previous.sceneEntryRowIndex, appendedSceneEntries, transcriptSceneEntryCount)
			: buildSceneEntryRowIndex(nextEntries);

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: appendTranscriptEntryIndex(
			previous.transcriptEntryById,
			appendedTranscriptEntries
		),
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
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

	const operationIndex = buildOperationIndex(input.graph.operations);
	const changedOperationIds = collectChangedOperationIds(
		previous.operationIndex,
		operationIndex
	);
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

	const nextEntries = previous.conversation.entries.slice();
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
		nextEntries[rowIndex] = materializeTranscriptEntry(
			transcriptEntry,
			input.graph,
			operationIndex,
			isRunning && transcriptEntry.entryId === liveAssistantEntryId
		);
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

function collectChangedOperationIds(
	previousOperationIndex: OperationIndex,
	operationIndex: OperationIndex
): Set<string> {
	const changed = new Set<string>();
	for (const [operationId, nextOperation] of operationIndex.byOperationId) {
		if (previousOperationIndex.byOperationId.get(operationId) !== nextOperation) {
			changed.add(operationId);
		}
	}
	for (const operationId of previousOperationIndex.byOperationId.keys()) {
		if (!operationIndex.byOperationId.has(operationId)) {
			changed.add(operationId);
		}
	}
	return changed;
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
): ReadonlyMap<string, TranscriptEntry> {
	const byEntryId = new Map<string, TranscriptEntry>();
	for (const entry of entries) {
		byEntryId.set(entry.entryId, entry);
	}
	return byEntryId;
}

function appendTranscriptEntryIndex(
	previous: ReadonlyMap<string, TranscriptEntry>,
	appendedEntries: readonly TranscriptEntry[]
): ReadonlyMap<string, TranscriptEntry> {
	if (appendedEntries.length === 0) {
		return previous;
	}

	const byEntryId = new Map(previous);
	for (const entry of appendedEntries) {
		byEntryId.set(entry.entryId, entry);
	}
	return byEntryId;
}

function collectAffectedTranscriptEntryIdsFromIndex(
	operationIndex: OperationIndex,
	changedOperationIds: ReadonlySet<string>,
	affectedEntryIds: Set<string>
): void {
	for (const operation of operationIndex.byOperationId.values()) {
		if (operation.source_link.kind !== "transcript_linked") {
			continue;
		}
		if (changedOperationIds.has(operation.id)) {
			affectedEntryIds.add(operation.source_link.entry_id);
			continue;
		}
		if (operation.child_operation_ids.some((operationId) => changedOperationIds.has(operationId))) {
			affectedEntryIds.add(operation.source_link.entry_id);
		}
	}
}

function buildSceneEntryRowIndex(
	entries: readonly AgentPanelSceneEntryModel[]
): ReadonlyMap<string, number> {
	const byEntryId = new Map<string, number>();
	entries.forEach((entry, index) => {
		byEntryId.set(entry.id, index);
	});
	return byEntryId;
}

function appendSceneEntryRowIndex(
	previous: ReadonlyMap<string, number>,
	appendedEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): ReadonlyMap<string, number> {
	if (appendedEntries.length === 0) {
		return previous;
	}

	const byEntryId = new Map(previous);
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

	let conversationEntries: readonly AgentPanelSceneEntryModel[] = Array.from(conversation.entries);
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
