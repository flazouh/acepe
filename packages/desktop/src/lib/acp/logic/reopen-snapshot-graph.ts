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
import type {
	RpcCompactionProjectedMessage,
	RpcProjectedMessage,
	RpcSessionSnapshot,
} from "@acepe/contracts";

import type {
	CanonicalAgentId,
	SessionCompactionEvent,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	TranscriptEntry,
} from "../../services/acp-types.js";
import { emptySessionGraphCapabilities } from "../store/envelope-reducer/empty-session-graph-capabilities.js";
import { isBuiltInCanonicalAgentId } from "../types/agent-id.js";

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

/**
 * `RpcSessionSnapshot.messages` is already in ascending-sequence (display)
 * order -- see `sessionSnapshot.ts`'s `applyEventToRpcSessionSnapshot`,
 * which only ever appends a new row or in-place-upserts the row a
 * `TokenAppended` event's first token already created, never reorders.
 * Nothing here re-sorts.
 */
export function transcriptEntriesFromSnapshotMessages(
	messages: ReadonlyArray<RpcProjectedMessage>
): TranscriptEntry[] {
	return messages.map(transcriptEntryFromMessage);
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
 * import-not-yet-imported-session step around it. `operations`/
 * `interactions` stay empty: transcript-viewport-rows-from-entries.ts
 * already documents that tool-call rows are left out of the Electrobun
 * transcript view entirely (no shared ordering key), so seeding them here
 * would not change what renders -- only entries do.
 */
export function graphFromReopenSnapshot(input: ReopenSnapshotGraphInput): SessionStateGraph {
	const revision: SessionGraphRevision = {
		graphRevision: 0,
		transcriptRevision: input.snapshot.snapshotSequence,
		lastEventSeq: input.snapshot.snapshotSequence,
	};
	const entries = transcriptEntriesFromSnapshotMessages(input.snapshot.messages);
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
		operations: [],
		interactions: [],
		turnState: "Idle",
		messageCount: input.snapshot.messages.length,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: lifecycleFromSnapshot(input.snapshot),
		activity: hasPendingApproval ? waitingForUserActivity : idleActivity,
		capabilities: emptySessionGraphCapabilities(),
	};
}
