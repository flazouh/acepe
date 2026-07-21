/**
 * Entry-level materializers for the canonical agent-panel graph materializer:
 * map a single canonical operation / transcript entry / pending question
 * interaction into a scene entry. Called by the conversation builders. Pure
 * projections over the canonical source — no canonical mutation. GOD-safe:
 * tool identity comes from canonical operation/tool-call ids, never reordered.
 */

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type {
	InteractionSnapshot,
	OperationSnapshot,
	TranscriptEntry,
} from "../../services/acp-types.js";
import { mapToolCallToSceneEntry } from "../components/agent-panel/scene/desktop-agent-panel-scene.js";
import { buildUserRowSceneModel } from "../logic/user-row-scene-model.js";
import { mapCanonicalTurnStateToPresentationStatus } from "../store/canonical-turn-state-mapping.js";
import { normalizeToolResult } from "../store/services/tool-result-normalizer.js";
import type { ToolCall } from "../types/tool-call.js";
import { mapOperationStateToToolPresentationStatus } from "../utils/tool-state-utils.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import { AGENT_PANEL_SCENE_TEXT_LIMITS } from "./agent-panel-graph-materializer-types.js";
import { displaySafeDegradationReason } from "./graph-lifecycle.js";
import { findOperationForTranscriptSourceEntry, type OperationIndex } from "./operation-index.js";
import { applySceneTextLimits, truncateDisplayText } from "./scene-text-limits.js";
import {
	assistantMarkdownText,
	buildAssistantMessageFromTranscriptEntry,
	segmentText,
} from "./transcript-text.js";
import { logUnresolvedToolDiagnostics } from "./unresolved-tool-diagnostics.js";

export function interactionSceneEntryId(interactionId: string): string {
	return `interaction:${interactionId}`;
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

export function materializeOperationSceneEntry(input: {
	readonly operation: OperationSnapshot;
	readonly graph: AgentPanelCanonicalSource;
	readonly index: OperationIndex;
	readonly displayEntryId: string | null;
}): AgentPanelSceneEntryModel {
	return materializeOperationEntry(
		input.operation,
		input.graph,
		input.index,
		new Set<string>(),
		input.displayEntryId
	);
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

export function materializeTranscriptEntry(
	entry: TranscriptEntry,
	graph: AgentPanelCanonicalSource,
	index: OperationIndex,
	isStreaming: boolean
): AgentPanelSceneEntryModel {
	if (entry.role === "user") {
		const userRow = buildUserRowSceneModel(entry);
		return {
			id: entry.entryId,
			type: "user",
			text: userRow.text,
			chunks: userRow.chunks.length > 0 ? userRow.chunks : undefined,
			timestampMs: entry.timestampMs ?? undefined,
		};
	}

	if (entry.role === "assistant") {
		const markdown = assistantMarkdownText(entry);
		const planningStartedAtMs =
			isStreaming && graph.activity.kind === "awaiting_model" && markdown.trim() === ""
				? (graph.activity.kindStartedAtMs ?? null)
				: null;
		return {
			id: entry.entryId,
			type: "assistant",
			markdown,
			message: buildAssistantMessageFromTranscriptEntry(entry),
			isStreaming: isStreaming,
			timestampMs: entry.timestampMs ?? undefined,
			planningStartedAtMs,
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

	throw new Error(`Unsupported transcript role: ${JSON.stringify(entry)}`);
}

export function questionInteractionToSceneEntry(
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
