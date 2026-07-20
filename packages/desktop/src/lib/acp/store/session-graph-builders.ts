/**
 * Canonical SessionStateGraph builders for the session store: immutable
 * graph-copy helpers (graphWith{TranscriptSnapshot,Lifecycle,Capabilities,Patches})
 * keyed by an exhaustive copy-key list, plus the session-export content-error
 * factory. Pure canonical-graph transforms — no projection state, no fallbacks.
 * GOD-safe.
 */
import type {
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	SessionTurnState,
	TranscriptSnapshot,
	TurnFailureSnapshot,
} from "../../services/acp-types.js";
import {
	mergeSessionGraphActivityTiming,
	seedSessionGraphActivityTimingIfNeeded,
} from "./envelope-reducer/merge-session-graph-activity-timing.js";
import { mergeInteractionSnapshots, mergeOperationSnapshots } from "./snapshot-merge.js";

const SESSION_STATE_GRAPH_COPY_KEYS = [
	"requestedSessionId",
	"canonicalSessionId",
	"isAlias",
	"agentId",
	"projectPath",
	"worktreePath",
	"sourcePath",
	"sequenceId",
	"revision",
	"transcriptSnapshot",
	"operations",
	"interactions",
	"turnState",
	"messageCount",
	"activeStreamingTail",
	"activeTurnFailure",
	"lastTerminalTurnId",
	"lifecycle",
	"activity",
	"capabilities",
] as const satisfies readonly (keyof SessionStateGraph)[];

type SessionStateGraphCopyKey = (typeof SESSION_STATE_GRAPH_COPY_KEYS)[number];
type MissingSessionStateGraphCopyKey = Exclude<keyof SessionStateGraph, SessionStateGraphCopyKey>;

export type SessionExportContentErrorKind = "session_not_found" | "thread_content_not_loaded";

export interface SessionExportContentError {
	readonly kind: SessionExportContentErrorKind;
	readonly message: string;
}

function assertSessionStateGraphCopyKeyCoverage(
	_coverage: Record<MissingSessionStateGraphCopyKey, never>
): void {}

assertSessionStateGraphCopyKeyCoverage({});

export function sessionExportContentError(
	kind: SessionExportContentErrorKind
): SessionExportContentError {
	switch (kind) {
		case "session_not_found":
			return {
				kind,
				message: "Session not found",
			};
		case "thread_content_not_loaded":
			return {
				kind,
				message: "Thread content is not loaded",
			};
	}
}

export function graphWithTranscriptSnapshot(
	graph: SessionStateGraph,
	transcriptSnapshot: TranscriptSnapshot,
	revision?: SessionGraphRevision
): SessionStateGraph {
	const nextRevision =
		revision === undefined
			? {
					graphRevision: graph.revision.graphRevision,
					transcriptRevision: transcriptSnapshot.revision,
					lastEventSeq: graph.revision.lastEventSeq,
				}
			: revision;
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		revision: nextRevision,
		transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail ?? null,
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle: graph.lifecycle,
		activity: graph.activity,
		capabilities: graph.capabilities,
	};
}

export function graphWithLifecycle(
	graph: SessionStateGraph,
	lifecycle: SessionGraphLifecycle,
	activity: SessionGraphActivity,
	revision: SessionGraphRevision
): SessionStateGraph {
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		revision,
		transcriptSnapshot: graph.transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail ?? null,
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle,
		activity,
		capabilities: graph.capabilities,
	};
}

export function graphWithCapabilities(
	graph: SessionStateGraph,
	capabilities: SessionGraphCapabilities,
	revision: SessionGraphRevision
): SessionStateGraph {
	return {
		requestedSessionId: graph.requestedSessionId,
		canonicalSessionId: graph.canonicalSessionId,
		isAlias: graph.isAlias,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		worktreePath: graph.worktreePath ?? null,
		sourcePath: graph.sourcePath ?? null,
		revision,
		transcriptSnapshot: graph.transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail ?? null,
		activeTurnFailure: graph.activeTurnFailure ?? null,
		lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
		lifecycle: graph.lifecycle,
		activity: graph.activity,
		capabilities,
	};
}

export function graphWithPatches(input: {
	readonly graph: SessionStateGraph;
	readonly revision: SessionGraphRevision;
	readonly activity: SessionGraphActivity | undefined;
	readonly turnState: SessionTurnState | undefined;
	readonly activeTurnFailure: TurnFailureSnapshot | null | undefined;
	readonly lastTerminalTurnId: string | null | undefined;
	readonly activeStreamingTail: SessionStateGraph["activeStreamingTail"] | undefined;
	readonly operationPatches: readonly OperationSnapshot[];
	readonly interactionPatches: readonly InteractionSnapshot[];
}): SessionStateGraph {
	const nextActivity =
		input.activity === undefined
			? input.graph.activity
			: mergeSessionGraphActivityTiming(input.graph.activity, input.activity, Date.now());

	return {
		requestedSessionId: input.graph.requestedSessionId,
		canonicalSessionId: input.graph.canonicalSessionId,
		isAlias: input.graph.isAlias,
		agentId: input.graph.agentId,
		projectPath: input.graph.projectPath,
		worktreePath: input.graph.worktreePath ?? null,
		sourcePath: input.graph.sourcePath ?? null,
		revision: input.revision,
		transcriptSnapshot: input.graph.transcriptSnapshot,
		operations:
			input.operationPatches.length === 0
				? input.graph.operations
				: mergeOperationSnapshots(input.graph.operations, input.operationPatches),
		interactions:
			input.interactionPatches.length === 0
				? input.graph.interactions
				: mergeInteractionSnapshots(input.graph.interactions, input.interactionPatches),
		turnState: input.turnState ?? input.graph.turnState,
		messageCount: input.graph.messageCount,
		activeStreamingTail:
			input.activeStreamingTail === undefined
				? (input.graph.activeStreamingTail ?? null)
				: input.activeStreamingTail,
		activeTurnFailure:
			input.activeTurnFailure === undefined
				? input.graph.activeTurnFailure
				: input.activeTurnFailure,
		lastTerminalTurnId:
			input.lastTerminalTurnId === undefined
				? input.graph.lastTerminalTurnId
				: input.lastTerminalTurnId,
		lifecycle: input.graph.lifecycle,
		activity: nextActivity,
		capabilities: input.graph.capabilities,
	};
}
