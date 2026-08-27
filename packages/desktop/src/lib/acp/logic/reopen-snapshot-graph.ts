/**
 * Reopen-session transcript hydration (closes the gap
 * orchestration-canonical-bridge.ts's header comment acknowledges:
 * "resumed/historical sessions are out of scope ... they depend on
 * history.getSessionOpenResult, itself unsupportedOnContract"). Builds a
 * full canonical `SessionStateGraph` -- transcript entries included -- from
 * the `{sessionId}` contract snapshot (`RpcSessionSnapshot`, the same
 * payload `sessionSnapshot.ts` keeps live via
 * `applyEventToRpcSessionSnapshot`), so a reopened session can seed its
 * graph through the exact same `replaceGraph` reducer path
 * (session-state-command-router.ts -> reduce-command.ts's
 * `reduceReplaceGraph`) that live orchestration deltas already use --
 * including its `isNewerGraphRevision` guard, which is what stops a late
 * hydration from stomping a graph a live session has already advanced past.
 *
 * agent-panel-conversation.ts's `conversationFromSnapshot` performs the
 * analogous `RpcProjectedMessage[] -> display entry` mapping for the
 * scaffold's `AgentPanelConversationEntry` shape. That target type is a UI
 * projection (plain text/markdown strings); `TranscriptEntry` here is the
 * canonical fact shape (role + segments) `SessionStateGraph` owns, so the
 * two mappers cannot share a function body -- but both walk
 * `snapshot.messages` in the same already-correct sequence order and switch
 * on the same three `rowType`s. Keep them in sync by hand if a fourth row
 * type is ever added.
 */
import type { EditEntry } from "../../services/converted-session-types.js";
import type {
	RpcCompactionProjectedMessage,
	RpcProjectedMessage,
	RpcProjectedPendingApproval,
	RpcProjectedSessionActivity,
	RpcSessionSnapshot,
} from "@acepe/contracts";

import type { JsonValue } from "../../services/converted-session-types.js";
import type {
	CanonicalAgentId,
	InteractionSnapshot,
	OperationSnapshot,
	SessionCompactionEvent,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	ToolArguments,
	TranscriptEntry,
} from "../../services/acp-types.js";
import { emptySessionGraphCapabilities } from "../store/envelope-reducer/empty-session-graph-capabilities.js";
import { isBuiltInCanonicalAgentId } from "../types/agent-id.js";
import type { ObservedToolCallStatus } from "./observed-tool-call-status.js";
import {
	observedStatusToOperationState,
	observedStatusToToolCallStatus,
} from "./observed-tool-call-status.js";
import { providerModels, providerModes } from "@acepe/contracts";
import { normalizeEditEntry } from "./aggregate-file-edits.js";
import { asOperationToolKind } from "./observed-tool-kind.js";

const idleActivity: SessionGraphActivity = {
	kind: "idle",
	activeOperationCount: 0,
	activeSubagentCount: 0,
};

const waitingForUserActivity: SessionGraphActivity = {
	kind: "waiting_for_user",
	activeOperationCount: 0,
	activeSubagentCount: 0,
};

export function canonicalAgentIdFromString(agentId: string): CanonicalAgentId {
	return isBuiltInCanonicalAgentId(agentId) ? agentId : { custom: agentId };
}

function compactionEventFromMessage(
	message: RpcCompactionProjectedMessage
): SessionCompactionEvent {
	return {
		eventId: message.messageId,
		sessionId: message.sessionId,
		status: message.content.status,
		trigger: message.content.trigger,
		preCompactionTokens: message.content.preCompactionTokens,
		postCompactionTokens: message.content.postCompactionTokens,
		droppedTokens: message.content.droppedTokens,
		contextWindowSize: message.content.contextWindowSize,
		summary: message.content.summary,
		providerMetadata: null,
	};
}

function transcriptEntryFromMessage(message: RpcProjectedMessage): TranscriptEntry {
	switch (message.rowType) {
		case "user":
			return {
				entryId: message.messageId,
				role: "user",
				segments: [
					{ kind: "text", segmentId: `${message.messageId}-text`, text: message.content.text },
				],
			};
		case "assistant":
			return {
				entryId: message.messageId,
				role: "assistant",
				segments: [
					{ kind: "text", segmentId: `${message.messageId}-text`, text: message.content.text },
				],
			};
		case "compaction":
			return {
				entryId: message.messageId,
				role: "sessionActivity",
				segments: [
					{
						kind: "compaction",
						segmentId: `${message.messageId}-compaction`,
						event: compactionEventFromMessage(message),
					},
				],
			};
	}
}

const noToolArguments: ToolArguments = { kind: "other", raw: null };

/** The reopen half of the bridge's `toolArgumentsFrom`: same rule, same reason. */
const toolArgumentsFromActivity = (activity: RpcProjectedSessionActivity): ToolArguments => {
	const input = activity.input;
	if (input === null || input === undefined) {
		return noToolArguments;
	}
	const raw = input as unknown as JsonValue;
	if (activity.toolKind !== "edit") {
		return { kind: "other", raw };
	}
	const entry = normalizeEditEntry(input);
	return entry === null
		? { kind: "other", raw }
		: { kind: "edit", edits: [asDiffableEdit(entry)] };
};

/** The reopen half of the bridge's `asDiffableEdit`. */
function asDiffableEdit(entry: EditEntry): EditEntry {
	return entry.newString !== null && entry.newString !== undefined
		? entry
		: {
				filePath: entry.filePath,
				oldString: entry.oldString,
				newString: entry.content ?? null,
				content: entry.content,
			};
}

// AC-263, reopen half: `RpcProjectedSessionActivity.status` is a free-form
// server string (Schema.optionalKey(Schema.String)), not the same literal
// union `observed-tool-call-status.ts` maps -- narrow the ones the server
// actually emits and fall back to "completed" for anything else (undefined
// included), since a reopened session's activities are historical: absent a
// live in-flight signal, "this tool call already finished" is the correct
// reading, not an invented "still running" state.
function observedStatusFromActivityStatus(status: string | undefined): ObservedToolCallStatus {
	if (status === "pending" || status === "in_progress" || status === "failed") {
		return status;
	}
	return "completed";
}

function transcriptEntryFromActivity(activity: RpcProjectedSessionActivity): TranscriptEntry {
	return {
		entryId: activity.activityId,
		role: "tool",
		segments: [
			{
				kind: "text",
				segmentId: `${activity.activityId}-text`,
				text: activity.title ?? "Tool call",
			},
		],
	};
}

function operationFromActivity(activity: RpcProjectedSessionActivity): OperationSnapshot {
	const toolCallId = activity.toolCallId ?? activity.activityId;
	const title = activity.title ?? "Tool call";
	return {
		id: activity.activityId,
		session_id: activity.sessionId,
		tool_call_id: toolCallId,
		name: title,
		// Canonical: the tool classification the snapshot now carries per
		// activity (tool_kind column), so a reopened session renders the
		// right card without re-parsing the display title.
		kind: asOperationToolKind(activity.toolKind),
		provider_status: observedStatusToToolCallStatus(
			observedStatusFromActivityStatus(activity.status)
		),
		title,
		// The tool's own arguments, carried per activity by the snapshot (input
		// column). A reopened session must show the same proposed change the
		// live bridge shows, or a permission that survives a reopen becomes
		// unreviewable.
		arguments: toolArgumentsFromActivity(activity),
		progressive_arguments: null,
		// #273, reopen half: the tool's own result, carried per activity by the
		// snapshot (output column). A reopened session must render the same
		// result the live bridge renders -- both paths seed one OperationSnapshot
		// per tool call, and transcript-viewport-row-mapper.ts reads
		// operation.result for the row's stdout either way.
		result: activity.output ?? null,
		command: null,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_state: observedStatusToOperationState(
			observedStatusFromActivityStatus(activity.status)
		),
		locations:
			activity.path === null || activity.path === undefined ? null : [{ path: activity.path }],
		awaiting_plan_approval: false,
		source_link: { kind: "transcript_linked", entry_id: activity.activityId },
	};
}

// #268 defect 2, reopen half: a session reopened while an approval is still
// pending used to seed activity: "waiting_for_user" (the composer correctly
// went quiet) but nothing else -- interactions stayed permanently [], so
// there was no row and no way to answer it. Reused the exact
// approvalRequestId-as-toolCallId row shape orchestration-canonical-bridge
// .ts's onApprovalRequested uses live, so a reopened session with a pending
// approval renders and behaves identically to one that hit the approval
// while already open.
const PENDING_APPROVAL_FALLBACK_TITLE = "Permission required";

function approvalEntryId(approval: RpcProjectedPendingApproval): string {
	return `entry-approval-${approval.approvalRequestId}`;
}

function transcriptEntryFromPendingApproval(
	approval: RpcProjectedPendingApproval
): TranscriptEntry {
	return {
		entryId: approvalEntryId(approval),
		role: "tool",
		// No text of its own: the tool call above names the change and the
		// working row below says the turn is waiting. The row exists to host
		// the permission bar.
		segments: [],
	};
}

/**
 * The row that hosts a pending permission carries no title of its own.
 *
 * It sits directly under the tool call it belongs to, which already names the
 * file or the command, and directly above the working row, which already says
 * "Waiting for your approval". A third line reading "Permission required" was
 * the same sentence again. The title stays on the interaction, where the bar
 * and assistive technology still read it.
 */
function operationFromPendingApproval(approval: RpcProjectedPendingApproval): OperationSnapshot {
	const title = approval.title ?? PENDING_APPROVAL_FALLBACK_TITLE;
	return {
		id: approval.approvalRequestId,
		session_id: approval.sessionId,
		tool_call_id: approval.approvalRequestId,
		name: title,
		kind: null,
		provider_status: observedStatusToToolCallStatus("pending"),
		title,
		arguments: noToolArguments,
		progressive_arguments: null,
		result: null,
		command: null,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_state: observedStatusToOperationState("pending"),
		locations: null,
		awaiting_plan_approval: false,
		source_link: { kind: "transcript_linked", entry_id: approvalEntryId(approval) },
	};
}

function interactionFromPendingApproval(
	approval: RpcProjectedPendingApproval
): InteractionSnapshot {
	const title = approval.title ?? PENDING_APPROVAL_FALLBACK_TITLE;
	return {
		id: approval.approvalRequestId,
		session_id: approval.sessionId,
		kind: "Permission",
		state: "Pending",
		json_rpc_request_id: null,
		reply_handler: null,
		tool_reference: { callId: approval.approvalRequestId },
		responded_at_event_seq: null,
		response: null,
		payload: {
			Permission: {
				id: approval.approvalRequestId,
				sessionId: approval.sessionId,
				permission: title,
				patterns: [],
				metadata: null,
				always: [],
				autoAccepted: false,
				tool: { callId: approval.approvalRequestId },
			},
		},
	};
}

type SequencedEntry = { readonly sequence: number; readonly entry: TranscriptEntry };

/**
 * Interleaves messages and activities into one sequence-ordered entries
 * list -- the reopen counterpart to `agent-panel-conversation.ts`'s
 * `conversationFromSnapshot`, which does the analogous sort-by-`sequence`
 * merge for the scaffold's `AgentPanelConversationEntry` shape. The two
 * cannot share a function body (different target types, same as the header
 * comment above already notes for messages alone), but the ordering
 * principle -- real server `sequence`, not a guessed position -- is the
 * same one, applied here to the canonical `TranscriptEntry` shape instead.
 */
export function transcriptEntriesFromSnapshot(snapshot: RpcSessionSnapshot): TranscriptEntry[] {
	const messageEntries: SequencedEntry[] = snapshot.messages.map((message) => ({
		sequence: message.sequence,
		entry: transcriptEntryFromMessage(message),
	}));
	const activityEntries: SequencedEntry[] = snapshot.activities.map((activity) => ({
		sequence: activity.sequence,
		entry: transcriptEntryFromActivity(activity),
	}));
	const approvalEntries: SequencedEntry[] = snapshot.pendingApprovals.map((approval) => ({
		sequence: approval.sequence,
		entry: transcriptEntryFromPendingApproval(approval),
	}));
	return [...messageEntries, ...activityEntries, ...approvalEntries]
		.sort((a, b) => a.sequence - b.sequence)
		.map((sequenced) => sequenced.entry);
}

export function operationsFromSnapshot(snapshot: RpcSessionSnapshot): OperationSnapshot[] {
	return [
		...snapshot.activities.map(operationFromActivity),
		...snapshot.pendingApprovals.map(operationFromPendingApproval),
	];
}

export function interactionsFromSnapshot(snapshot: RpcSessionSnapshot): InteractionSnapshot[] {
	return snapshot.pendingApprovals.map(interactionFromPendingApproval);
}

function lifecycleForStatus(status: SessionGraphLifecycle["status"]): SessionGraphLifecycle {
	return {
		status,
		actionability: {
			canSend: status === "ready",
			canResume: status === "detached" || status === "archived",
			canRetry: status === "failed",
			canArchive: status === "ready",
			canConfigure: status === "ready",
			recommendedAction: "none",
			recoveryPhase: "none",
			compactStatus: status,
		},
	};
}

/**
 * Mirrors `tauri-client/acp.ts`'s private `lifecycleForSession` (same
 * decision, same fields) over a snapshot the caller already fetched, rather
 * than importing across that module boundary for one status derivation.
 */
function lifecycleFromSnapshot(snapshot: RpcSessionSnapshot): SessionGraphLifecycle {
	if (snapshot.session === null) {
		return lifecycleForStatus("reserved");
	}
	if (snapshot.session.deletedAt !== null) {
		return lifecycleForStatus("failed");
	}
	if (snapshot.session.archivedAt !== null) {
		return lifecycleForStatus("archived");
	}
	return lifecycleForStatus("ready");
}

export interface ReopenSnapshotGraphInput {
	readonly requestedSessionId: string;
	readonly canonicalSessionId: string;
	readonly agentId: string;
	readonly projectPath: string;
	readonly worktreePath: string | null;
	readonly sourcePath: string | null;
	readonly sequenceId: number | null;
	readonly snapshot: RpcSessionSnapshot;
}

/**
 * Builds a full canonical graph for a reopened session from its contract
 * snapshot -- pure, so callers own the RPC fetch and the (idempotent)
 * import-not-yet-imported-session step around it. `operations` is seeded
 * from `snapshot.activities` (AC-263): each historical tool activity gets a
 * `role: "tool"` transcript entry, interleaved by real sequence, plus its
 * linked OperationSnapshot -- see `transcriptEntriesFromSnapshot`/
 * `operationsFromSnapshot`. `interactions` is seeded the same way from
 * `snapshot.pendingApprovals` (#268 defect 2): the snapshot only exposes
 * still-pending approvals, not resolved historical ones, but a still-pending
 * one reopened with the session must render and stay answerable, not
 * silently vanish -- see `interactionsFromSnapshot`.
 */
/**
 * Decides whether a freshly-built reopen graph should actually be applied
 * over whatever the local graph currently holds, and if so, computes a
 * revision guaranteed to be recognized as newer by `isNewerGraphRevision`
 * -- mirroring `session-open-snapshot-applier.svelte.ts`'s
 * `shouldApplyCanonicalGraph` ("snapshot wins if strictly newer") instead of
 * only applying when the local graph starts out empty (AC-263 issue #263
 * defect 2).
 *
 * `graphFromReopenSnapshot` always stamps `graphRevision: 0`: unlike the
 * Tauri-era `graphFromSessionOpenFound`, there is no Rust-owned graphRevision
 * counter behind the Electrobun RPC snapshot to carry through. Compared via
 * the plain `isNewerGraphRevision` (which orders on graphRevision first), a
 * reopen can therefore never outrank a local graph that has already advanced
 * past graphRevision 0 through live deltas -- even when the reopen's own
 * `transcriptRevision` (the snapshot's real, monotonic server-side sequence)
 * is genuinely newer. This widens the reopen's revision just enough to win
 * in that case, by bumping graphRevision relative to whatever the local
 * graph already carries, while still refusing to apply (returning `null`)
 * whenever the local graph's transcript is already at least as new -- the
 * same "never stomp a newer graph" protection `graphFromReopenSnapshot`'s
 * own revision already gives it against a genuinely-live graph.
 */
export function reopenGraphRevisionForApply(
	graph: SessionStateGraph,
	currentRevision: SessionGraphRevision | null
): SessionGraphRevision | null {
	if (currentRevision === null) {
		return graph.revision;
	}
	if (graph.transcriptSnapshot.revision <= currentRevision.transcriptRevision) {
		return null;
	}
	return {
		graphRevision: currentRevision.graphRevision + 1,
		transcriptRevision: graph.transcriptSnapshot.revision,
		lastEventSeq: currentRevision.lastEventSeq + 1,
	};
}

/**
 * #272: `currentModeId` is canonical-owned -- the server folds every
 * `SessionModeSet` into it (ProjectionSessions) and hands it over as
 * `RpcProjectedSession.currentModeId`. A reopen that drops it leaves the mode
 * the agent runs disagreeing with the mode the UI shows, which is exactly the
 * lazy-reopen desync the server-side fix targets.
 *
 * The empty capabilities stay the default on purpose. `null` means no
 * `SessionModeSet` ever fired, and only then does the provider's opening mode
 * stand -- so only a real canonical mode may add a `modes` object here.
 * Seeding one unconditionally would also flip the provider-owned
 * `availableModes` from `null` ("not known yet") to an empty list, because
 * capability-projection.ts's `mapGraphAvailableModes` keys on `modes` being
 * present at all.
 */
function capabilitiesFromSnapshot(snapshot: RpcSessionSnapshot): SessionGraphCapabilities {
	const capabilities = emptySessionGraphCapabilities();
	const currentModeId = snapshot.session?.currentModeId ?? null;
	// The modes and models a provider offers, so a reopened session shows the
	// same pickers a live one does. These are provider facts, not session state:
	// the comment above is about `currentModeId`, which stays canonical-owned
	// and is only set when a SessionModeSet actually fired.
	const modes = providerModes(snapshot.session?.provider);
	const models = providerModels(snapshot.session?.provider);
	if (modes.length > 0 || currentModeId !== null) {
		capabilities.modes = {
			...(currentModeId === null ? {} : { currentModeId }),
			...(modes.length === 0
				? {}
				: {
						availableModes: modes.map((mode) => ({
							id: mode.id,
							name: mode.name,
							description: mode.description,
							iconKind: mode.iconKind,
						})),
					}),
		};
	}
	if (models.length > 0) {
		capabilities.models = {
			availableModels: models.map((model) => ({
				modelId: model.modelId,
				name: model.name,
			})),
		};
	}
	return capabilities;
}

export function graphFromReopenSnapshot(input: ReopenSnapshotGraphInput): SessionStateGraph {
	const revision: SessionGraphRevision = {
		graphRevision: 0,
		transcriptRevision: input.snapshot.snapshotSequence,
		lastEventSeq: input.snapshot.snapshotSequence,
	};
	const entries = transcriptEntriesFromSnapshot(input.snapshot);
	const operations = operationsFromSnapshot(input.snapshot);
	const interactions = interactionsFromSnapshot(input.snapshot);
	const hasPendingApproval = input.snapshot.pendingApprovals.length > 0;
	return {
		requestedSessionId: input.requestedSessionId,
		canonicalSessionId: input.canonicalSessionId,
		isAlias: false,
		agentId: canonicalAgentIdFromString(input.agentId),
		projectPath: input.projectPath,
		worktreePath: input.worktreePath,
		sourcePath: input.sourcePath,
		sequenceId: input.sequenceId,
		revision,
		transcriptSnapshot: { revision: input.snapshot.snapshotSequence, entries },
		operations,
		interactions,
		turnState: "Idle",
		messageCount: input.snapshot.messages.length,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: lifecycleFromSnapshot(input.snapshot),
		activity: hasPendingApproval ? waitingForUserActivity : idleActivity,
		capabilities: capabilitiesFromSnapshot(input.snapshot),
	};
}
