// #249 slice 1: the canonical SessionStateGraph that MainAppView's transcript
// reads (see session-state-command-router.ts / GOD architecture) used to be
// materialized entirely by the Rust ACP service and pushed over an
// eventsUrl SSE stream (acp.getEventBridgeInfo). Electrobun has no such
// producer -- packages/server's projector does not carry transcript/
// operations/interactions/turnState yet (see tauri-client/history.ts's
// getSessionOpenResult header comment for the same acknowledged gap).
//
// This module is the smallest HONEST stand-in: a pure, per-session state
// machine that watches the orchestration `events` stream and synthesizes
// just enough SessionStateEnvelope traffic (an initial "snapshot", then
// contiguous "delta"s) for a session CREATED LIVE in this app run to show
// its real streamed reply, tool calls, and approval requests in the real
// agent panel. It is not the full canonical graph: turn completion has no
// orchestration event yet (TurnCancelled is the only terminal signal on the
// contract today), so turnState never leaves "Running" after the first
// reply starts -- documented here rather than faked. Resumed/historical
// sessions are out of scope (they depend on history.getSessionOpenResult,
// itself unsupportedOnContract for the same reason).
import type { OrchestrationEvent, SessionId } from "@acepe/contracts";
import { librarySnapshotRequest, type RpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type {
	CanonicalAgentId,
	InteractionSnapshot,
	OperationSnapshot,
	OperationState,
	SessionGraphActivity,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateField,
	SessionTurnState,
	ToolArguments,
	TranscriptDeltaOperation,
} from "../../services/acp-types.js";
import type { ToolCallStatus } from "../../services/converted-session-types.js";
import type { AcpEventEnvelope } from "./acp-event-bridge.js";

type SessionCanonicalState = {
	revision: SessionGraphRevision;
	turnState: SessionTurnState;
	activity: SessionGraphActivity;
	assistantEntryId: string | null;
	assistantSegmentSeq: number;
};

const KNOWN_AGENT_IDS: ReadonlySet<string> = new Set([
	"claude-code",
	"copilot",
	"cursor",
	"opencode",
	"codex",
	"forge",
] satisfies ReadonlyArray<Exclude<CanonicalAgentId, { custom: string }>>);

const toCanonicalAgentId = (providerId: string | undefined): CanonicalAgentId =>
	providerId !== undefined && KNOWN_AGENT_IDS.has(providerId)
		? (providerId as CanonicalAgentId)
		: "claude-code";

const idleActivity: SessionGraphActivity = {
	kind: "idle",
	activeOperationCount: 0,
	activeSubagentCount: 0,
};

const awaitingModelActivity: SessionGraphActivity = {
	kind: "awaiting_model",
	activeOperationCount: 0,
	activeSubagentCount: 0,
};

const noArguments: ToolArguments = { kind: "other", raw: null };

const observedStatusToOperationState = (
	status: "pending" | "in_progress" | "completed" | "failed"
): OperationState => {
	switch (status) {
		case "pending":
			return "pending";
		case "in_progress":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
	}
};

const observedStatusToToolCallStatus = (
	status: "pending" | "in_progress" | "completed" | "failed"
): ToolCallStatus => status;

function nextRevision(current: SessionGraphRevision, transcriptAdvanced: boolean): SessionGraphRevision {
	return {
		graphRevision: current.graphRevision + 1,
		transcriptRevision: transcriptAdvanced
			? current.transcriptRevision + 1
			: current.transcriptRevision,
		lastEventSeq: current.lastEventSeq + 1,
	};
}

function envelopeForDelta(
	sessionId: string,
	toRevision: SessionGraphRevision,
	delta: SessionStateDelta
): SessionStateEnvelope {
	return {
		sessionId,
		graphRevision: toRevision.graphRevision,
		lastEventSeq: toRevision.lastEventSeq,
		payload: { kind: "delta", delta },
	};
}

/**
 * Translates the global orchestration `events` stream into the
 * SessionStateEnvelope traffic MainAppView's canonical store consumes,
 * scoped to sessions this bridge itself has seen created. Stateful (per
 * session revision tracking + a one-shot project-path cache), so it is a
 * class rather than a pure function -- but every method is a plain
 * synchronous transform over its own state plus the event, so it stays
 * unit-testable without a real RpcClient (see the colocated test file,
 * which fakes `resolveProjectPath`).
 */
export class OrchestrationCanonicalBridge {
	private readonly sessions = new Map<string, SessionCanonicalState>();

	constructor(private readonly resolveProjectPath: (projectId: string) => Effect.Effect<string, never>) {}

	translate(event: OrchestrationEvent): Effect.Effect<AcpEventEnvelope[], never> {
		switch (event.type) {
			case "SessionCreated":
				return this.onSessionCreated(event.payload.sessionId, event.payload.projectId, event.payload.providerId);
			case "MessageSent":
				return Effect.succeed(this.onMessageSent(event.payload.sessionId, event.payload.messageId, event.payload.text));
			case "TokenAppended":
				return Effect.succeed(
					this.onTokenAppended(event.payload.sessionId, event.payload.messageId, event.payload.token)
				);
			case "ToolCallObserved":
				return Effect.succeed(this.onToolCallObserved(event.payload));
			case "ApprovalRequested":
				return Effect.succeed(this.onApprovalRequested(event.payload));
			case "TurnCancelled":
				return Effect.succeed(this.onTurnCancelled(event.payload.sessionId, event.payload.turnId ?? null));
			default:
				// Every other OrchestrationEventType (git/voice/checkpoint/settings/
				// agent-management/...) is outside this bridge's scope -- log-and-
				// skip, never crash. See this file's header comment.
				return Effect.succeed([]);
		}
	}

	private onSessionCreated(
		sessionId: SessionId,
		projectId: string,
		providerId: string | undefined
	): Effect.Effect<AcpEventEnvelope[], never> {
		return this.resolveProjectPath(projectId).pipe(
			Effect.map((projectPath) => {
				const revision: SessionGraphRevision = { graphRevision: 0, transcriptRevision: 0, lastEventSeq: 0 };
				this.sessions.set(sessionId, {
					revision,
					turnState: "Idle",
					activity: idleActivity,
					assistantEntryId: null,
					assistantSegmentSeq: 0,
				});
				const envelope: SessionStateEnvelope = {
					sessionId,
					graphRevision: 0,
					lastEventSeq: 0,
					payload: {
						kind: "snapshot",
						graph: {
							requestedSessionId: sessionId,
							canonicalSessionId: sessionId,
							isAlias: false,
							agentId: toCanonicalAgentId(providerId),
							projectPath,
							revision,
							transcriptSnapshot: { revision: 0, entries: [] },
							operations: [],
							interactions: [],
							turnState: "Idle",
							messageCount: 0,
							activeStreamingTail: null,
							lifecycle: {
								status: "ready",
								actionability: {
									canSend: true,
									canResume: false,
									canRetry: false,
									canArchive: true,
									canConfigure: true,
									recommendedAction: "none",
									recoveryPhase: "none",
									compactStatus: "ready",
								},
							},
							activity: idleActivity,
							capabilities: {},
						},
					},
				};
				return [toSessionStateAcpEnvelope(envelope)];
			})
		);
	}

	private onMessageSent(sessionId: string, messageId: string, text: string): AcpEventEnvelope[] {
		const state = this.sessions.get(sessionId);
		if (state === undefined) {
			return [];
		}
		const toRevision = nextRevision(state.revision, true);
		const operations: TranscriptDeltaOperation[] = [
			{
				kind: "appendEntry",
				entry: {
					entryId: `entry-${messageId}`,
					role: "user",
					segments: [{ kind: "text", segmentId: `seg-${messageId}`, text }],
				},
			},
		];
		const changedFields: SessionStateField[] = ["transcriptSnapshot", "turnState", "activity"];
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity: awaitingModelActivity,
			turnState: "Running",
			activeStreamingTail: null,
			transcriptOperations: operations,
			operationPatches: [],
			interactionPatches: [],
			changedFields,
		};
		state.revision = toRevision;
		state.turnState = "Running";
		state.activity = awaitingModelActivity;
		state.assistantEntryId = null;
		state.assistantSegmentSeq = 0;
		return [toSessionStateAcpEnvelope(envelopeForDelta(sessionId, toRevision, delta))];
	}

	private onTokenAppended(sessionId: string, messageId: string, token: string): AcpEventEnvelope[] {
		const state = this.sessions.get(sessionId);
		if (state === undefined) {
			return [];
		}
		const toRevision = nextRevision(state.revision, true);
		const operations: TranscriptDeltaOperation[] =
			state.assistantEntryId === null
				? [
						{
							kind: "appendEntry",
							entry: {
								entryId: `entry-assistant-${messageId}`,
								role: "assistant",
								segments: [{ kind: "text", segmentId: `seg-${messageId}-0`, text: token }],
							},
						},
					]
				: [
						{
							kind: "appendSegment",
							entryId: state.assistantEntryId,
							role: "assistant",
							segment: {
								kind: "text",
								segmentId: `seg-${messageId}-${String(state.assistantSegmentSeq)}`,
								text: token,
							},
						},
					];
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity: awaitingModelActivity,
			turnState: "Running",
			activeStreamingTail: null,
			transcriptOperations: operations,
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["transcriptSnapshot"],
		};
		state.revision = toRevision;
		state.assistantEntryId = `entry-assistant-${messageId}`;
		state.assistantSegmentSeq += 1;
		return [toSessionStateAcpEnvelope(envelopeForDelta(sessionId, toRevision, delta))];
	}

	private onToolCallObserved(payload: {
		readonly sessionId: SessionId;
		readonly toolCallId: string;
		readonly status: "pending" | "in_progress" | "completed" | "failed";
		readonly title: string;
		readonly path: string | null;
	}): AcpEventEnvelope[] {
		const state = this.sessions.get(payload.sessionId);
		if (state === undefined) {
			return [];
		}
		const toRevision = nextRevision(state.revision, false);
		const operation: OperationSnapshot = {
			id: payload.toolCallId,
			session_id: payload.sessionId,
			tool_call_id: payload.toolCallId,
			name: payload.title,
			kind: null,
			provider_status: observedStatusToToolCallStatus(payload.status),
			title: payload.title,
			arguments: noArguments,
			progressive_arguments: null,
			result: null,
			command: null,
			normalized_todos: null,
			parent_tool_call_id: null,
			parent_operation_id: null,
			child_tool_call_ids: [],
			child_operation_ids: [],
			operation_state: observedStatusToOperationState(payload.status),
			awaiting_plan_approval: false,
			source_link: { kind: "synthetic", reason: "orchestration-canonical-bridge:tool-call-observed" },
		};
		const activity: SessionGraphActivity =
			payload.status === "completed" || payload.status === "failed"
				? awaitingModelActivity
				: { kind: "running_operation", activeOperationCount: 1, activeSubagentCount: 0, dominantOperationId: operation.id };
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity,
			turnState: state.turnState,
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches: [operation],
			interactionPatches: [],
			changedFields: ["operations", "activity"],
		};
		state.revision = toRevision;
		state.activity = activity;
		return [toSessionStateAcpEnvelope(envelopeForDelta(payload.sessionId, toRevision, delta))];
	}

	private onApprovalRequested(payload: {
		readonly sessionId: SessionId;
		readonly approvalRequestId: string;
		readonly title: string;
	}): AcpEventEnvelope[] {
		const state = this.sessions.get(payload.sessionId);
		if (state === undefined) {
			return [];
		}
		const toRevision = nextRevision(state.revision, false);
		const interaction: InteractionSnapshot = {
			id: payload.approvalRequestId,
			session_id: payload.sessionId,
			kind: "Permission",
			state: "Pending",
			json_rpc_request_id: null,
			reply_handler: null,
			tool_reference: null,
			responded_at_event_seq: null,
			response: null,
			payload: {
				Permission: {
					id: payload.approvalRequestId,
					sessionId: payload.sessionId,
					permission: payload.title,
					patterns: [],
					metadata: null,
					always: [],
					autoAccepted: false,
				},
			},
		};
		const activity: SessionGraphActivity = {
			kind: "waiting_for_user",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			blockingInteractionId: payload.approvalRequestId,
		};
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity,
			turnState: state.turnState,
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches: [],
			interactionPatches: [interaction],
			changedFields: ["interactions", "activity"],
		};
		state.revision = toRevision;
		state.activity = activity;
		return [toSessionStateAcpEnvelope(envelopeForDelta(payload.sessionId, toRevision, delta))];
	}

	private onTurnCancelled(sessionId: string, _turnId: string | null): AcpEventEnvelope[] {
		const state = this.sessions.get(sessionId);
		if (state === undefined) {
			return [];
		}
		const toRevision = nextRevision(state.revision, false);
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity: idleActivity,
			turnState: "Cancelled",
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["turnState", "activity"],
		};
		state.revision = toRevision;
		state.turnState = "Cancelled";
		state.activity = idleActivity;
		state.assistantEntryId = null;
		return [toSessionStateAcpEnvelope(envelopeForDelta(sessionId, toRevision, delta))];
	}
}

let acpEnvelopeSeq = 0;

function toSessionStateAcpEnvelope(envelope: SessionStateEnvelope): AcpEventEnvelope {
	acpEnvelopeSeq += 1;
	return {
		seq: acpEnvelopeSeq,
		eventName: "acp-session-state",
		sessionId: envelope.sessionId,
		// SessionStateEnvelope is plain JSON-shaped data (string/number/boolean/
		// null/array/object leaves only); this bridge builds it directly rather
		// than round-tripping through JSON.stringify/parse like the retired SSE
		// path did, so the cast documents shape equivalence instead of proving
		// it structurally.
		payload: envelope as unknown as AcpEventEnvelope["payload"],
		priority: "normal",
		droppable: false,
		emittedAtMs: Date.now(),
	};
}

export function makeProjectPathResolver(
	client: RpcClient
): (projectId: string) => Effect.Effect<string, never> {
	let cache: ReadonlyMap<string, string> | null = null;
	return (projectId: string) =>
		Effect.gen(function* () {
			if (cache === null) {
				const snapshot = yield* client.snapshot(librarySnapshotRequest()).pipe(Effect.orElseSucceed(() => ({ projects: [] as ReadonlyArray<{ projectId: string; workspaceRoot: string }> })));
				cache = new Map(snapshot.projects.map((project) => [project.projectId, project.workspaceRoot]));
			}
			return cache.get(projectId) ?? "";
		});
}
