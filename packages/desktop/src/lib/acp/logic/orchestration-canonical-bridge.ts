// #249 slice 1: the canonical SessionStateGraph that MainAppView's transcript
// reads (see session-state-command-router.ts / GOD architecture) used to be
// materialized entirely by the Rust ACP service and pushed over an
// eventsUrl SSE stream (acp.getEventBridgeInfo). Electrobun has no such
// producer -- packages/server's projector does not carry transcript/
// operations/interactions/turnState yet (see backend-client/history.ts's
// getSessionOpenResult header comment for the same acknowledged gap).
//
// This module is the smallest HONEST stand-in: a pure, per-session state
// machine that watches the orchestration `events` stream and synthesizes
// just enough SessionStateEnvelope traffic (an initial "snapshot", then
// contiguous "delta"s) for a session CREATED LIVE in this app run to show
// its real streamed reply, tool calls, and approval requests in the real
// agent panel. It is not the full canonical graph -- e.g. resumed/historical
// sessions are out of scope (they depend on history.getSessionOpenResult,
// itself unsupportedOnContract for the same reason) -- but turn completion
// (TurnCompleted, alongside TurnCancelled) IS a real terminal signal on the
// contract, handled below.

import type {
	ApprovalDecision,
	OrchestrationEvent,
	ProviderOperation,
	SessionId,
} from "@acepe/contracts";
import {
	librarySnapshotRequest,
	providerModes,
	type RpcClient,
	sessionAuthRequiredFromMetadata,
	sessionModelsFromMetadata,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type {
	CanonicalAgentId,
	InteractionSnapshot,
	OperationSnapshot,
	OperationState,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateField,
	SessionTurnState,
	ToolArguments,
	TranscriptDeltaOperation,
	TurnFailureSnapshot,
	UsageTelemetryData,
} from "../../services/acp-types.js";
import type { EditEntry, JsonValue } from "../../services/converted-session-types.js";
import { emptySessionGraphCapabilities } from "../store/envelope-reducer/empty-session-graph-capabilities.js";
import { AGENT_IDS } from "../types/agent-id.js";
import type { AcpEventEnvelope } from "./acp-event-bridge.js";
import {
	observedStatusToOperationState,
	observedStatusToToolCallStatus,
} from "./observed-tool-call-status.js";
import { asOperationToolKind } from "./observed-tool-kind.js";
import { noToolArguments, toolArgumentsFromCanonical } from "./tool-arguments-projection.js";

type PendingApprovalRecord = {
	readonly toolCallId: string;
	readonly title: string;
};

type SessionCanonicalState = {
	revision: SessionGraphRevision;
	turnState: SessionTurnState;
	activity: SessionGraphActivity;
	assistantEntryId: string | null;
	assistantSegmentSeq: number;
	// AC-263: bumped each time a fresh assistant entry starts after a tool
	// call reset assistantEntryId to null mid-turn, so a later run reusing the
	// same provider messageId still gets a distinct, non-colliding entryId
	// instead of silently re-merging into the pre-tool-call entry's id.
	assistantEntryRunSeq: number;
	// AC-263: toolCallIds that already have a "tool" transcript entry, so a
	// status-only re-observation (pending -> in_progress -> completed) patches
	// the existing operation instead of appending a duplicate row.
	observedToolCallIds: Set<string>;
	// #268 defect 2: approvalRequestIds that already have their own transcript
	// entry, so a redelivered ApprovalRequested (replay racing live, the same
	// dedup hazard tool calls have) patches the existing row instead of
	// appending a duplicate.
	observedApprovalIds: Set<string>;
	// What each still-unanswered approval is attached to, so the canonical
	// answer (InteractionReplied, which carries only the approval id and the
	// decision) can be patched back onto the same interaction with the same
	// tool reference and title rather than inventing them.
	pendingApprovals: Map<string, PendingApprovalRecord>;
	// The last emitted snapshot of every operation whose operation_state is
	// still non-terminal, keyed by toolCallId. A terminal turn is the outer
	// bound of every operation in it: nothing can advance one of these after
	// TurnCompleted/TurnCancelled/ProviderSessionFailed fires, so endTurn
	// settles whatever is left here (see the abandoned-approval hang its test
	// documents) and a terminal ToolCallObserved removes its own entry.
	openOperations: Map<string, OperationSnapshot>;
	// Whether the provider answered a turn with its signed-out rendering
	// (canonical auth_required fact -- see @acepe/contracts sessionAuth.ts).
	// While set, the lifecycle carries detachedReason "awaitingAuthentication"
	// so the pre-composer sign-in card shows; the next prompt attempt clears
	// it (a still-signed-out account simply re-raises the fact).
	authRequired: boolean;
	// AC-269: epoch-ms the CURRENTLY open turn started, or null when no turn
	// is open -- the Claude Code working line's elapsed timer reads this via
	// SessionGraphActivity.kindStartedAtMs (see awaitingModelActivityAt).
	// Parsed from the MessageSent event's own occurredAt (server wall-clock),
	// not client Date.now(), so the timer is not skewed by request latency.
	// Cleared on TurnCancelled/TurnCompleted.
	turnStartedAtMs: number | null;
};

const KNOWN_AGENT_IDS: ReadonlySet<string> = new Set(Object.values(AGENT_IDS));

const toCanonicalAgentId = (providerId: string | undefined): CanonicalAgentId =>
	providerId !== undefined && KNOWN_AGENT_IDS.has(providerId)
		? (providerId as CanonicalAgentId)
		: "claude-code";

// Only reachable when the answer arrives for an approval this bridge never
// saw requested, which is the reopened-session case below.
const RESOLVED_APPROVAL_FALLBACK_TITLE = "Permission request";

/**
 * One definition of a session's starting state, shared by `SessionCreated` and
 * by a first sighting mid-stream, so the two cannot drift apart.
 */
function freshSessionState(): SessionCanonicalState {
	return {
		revision: { graphRevision: 0, transcriptRevision: 0, lastEventSeq: 0 },
		turnState: "Idle",
		activity: idleActivity,
		assistantEntryId: null,
		assistantSegmentSeq: 0,
		assistantEntryRunSeq: 0,
		observedToolCallIds: new Set(),
		observedApprovalIds: new Set(),
		pendingApprovals: new Map(),
		openOperations: new Map(),
		authRequired: false,
		turnStartedAtMs: null,
	};
}

/**
 * The capabilities a provider brings to every session it opens.
 *
 * The modes are read from the contract rather than assembled here: the adapter
 * that enforces a mode and the picker that offers it must be reading one list.
 *
 * The models are absent on purpose. They used to be a constant of five read
 * from the same contract, so an agent that shipped a newer model could not be
 * asked for it. A provider is now asked for its own catalog and publishes it as
 * a session_models fact, which arrives after this event -- see
 * onSessionModelsListed.
 */
function providerSessionCapabilities(
	providerId: string | null | undefined
): SessionGraphCapabilities {
	const modes = providerModes(providerId);
	const capabilities = emptySessionGraphCapabilities();
	if (modes.length > 0) {
		capabilities.modes = {
			availableModes: modes.map((mode) => ({
				id: mode.id,
				name: mode.name,
				description: mode.description,
				iconKind: mode.iconKind,
			})),
		};
	}
	return capabilities;
}

const idleActivity: SessionGraphActivity = {
	kind: "idle",
	activeOperationCount: 0,
	activeSubagentCount: 0,
};

// AC-269: "awaiting_model" activity, stamped with the turn's real start time
// so the working line's elapsed timer has something to read. Replaced the
// prior module-level constant (every "awaiting_model" site now needs a
// per-session/per-turn value here, not a shared one).
function awaitingModelActivityAt(turnStartedAtMs: number | null): SessionGraphActivity {
	return {
		kind: "awaiting_model",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		kindStartedAtMs: turnStartedAtMs,
	};
}

const PERMISSION_ID_PREFIX = "perm-";

// AC-280: a real permission id is always perm-<toolCallId> -- see
// permissionIdForToolCall in the server's Claude/Cursor/Copilot Tools.ts.
// Returns the tool-call row already tracked for that underlying toolCallId,
// or null when there is none (either the id isn't perm-prefixed, or no
// ToolCallObserved for it has arrived yet).
function existingRowToolCallIdForApproval(
	state: SessionCanonicalState,
	approvalRequestId: string
): string | null {
	if (!approvalRequestId.startsWith(PERMISSION_ID_PREFIX)) {
		return null;
	}
	const toolCallId = approvalRequestId.slice(PERMISSION_ID_PREFIX.length);
	return state.observedToolCallIds.has(toolCallId) ? toolCallId : null;
}

function nextRevision(
	current: SessionGraphRevision,
	transcriptAdvanced: boolean
): SessionGraphRevision {
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

	constructor(
		private readonly resolveProjectPath: (projectId: string) => Effect.Effect<string, never>
	) {}

	/**
	 * The state for a session, created on first sight if this bridge has not
	 * seen the session before.
	 *
	 * Every handler used to answer an unknown session with `[]`, which reads as
	 * "nothing happened" and is a lie: the event carries canonical truth the
	 * server has already committed. A subscription that starts mid-stream never
	 * sees `SessionCreated`, and against a real Claude Code session that meant
	 * five tool calls and a pending permission were dropped one by one while
	 * the panel showed two rows and the agent sat blocked on an approval nobody
	 * was shown. The reopen hydration could not repair it either, because by
	 * then the local transcript revision was no older than the snapshot's.
	 *
	 * `SessionCreated` stays the authoritative registration: it is the only
	 * event carrying the project and provider, so it still emits the seeding
	 * snapshot envelope and overwrites whatever a mid-stream sighting started.
	 * What it no longer does is decide whether later truth is allowed through.
	 */
	/**
	 * Moves a session to where something else has just put it.
	 *
	 * A reopen hydrates the client graph from the contract snapshot, whose
	 * revision is the server's own sequence, while this bridge counts a
	 * session's revisions from zero. Two number spaces that never met: after any
	 * reopen every delta produced here started at a revision the client had long
	 * passed, the router read that as a frontier mismatch, and the session
	 * stopped applying events entirely while the server kept committing them.
	 *
	 * The bridge cannot know where a reopen landed, so the reopen tells it. The
	 * rest of the session's state is deliberately untouched: which tool calls
	 * have been seen and which approvals are open are still true, and only the
	 * revision moved.
	 */
	realignSession(sessionId: string, revision: SessionGraphRevision): void {
		this.stateFor(sessionId).revision = revision;
	}

	private stateFor(sessionId: string): SessionCanonicalState {
		const existing = this.sessions.get(sessionId);
		if (existing !== undefined) {
			return existing;
		}
		const created = freshSessionState();
		this.sessions.set(sessionId, created);
		return created;
	}

	translate(event: OrchestrationEvent): Effect.Effect<AcpEventEnvelope[], never> {
		switch (event.type) {
			case "SessionCreated":
				return this.onSessionCreated(
					event.payload.sessionId,
					event.payload.projectId,
					event.payload.providerId
				);
			case "MessageSent":
				return Effect.succeed(
					this.onMessageSent(
						event.payload.sessionId,
						event.payload.messageId,
						event.payload.text,
						event.occurredAt
					)
				);
			case "TokenAppended":
				return Effect.succeed(
					this.onAssistantStreamAppended(
						event.payload.sessionId,
						event.payload.messageId,
						event.payload.token,
						"text"
					)
				);
			case "ThoughtAppended":
				return Effect.succeed(
					this.onAssistantStreamAppended(
						event.payload.sessionId,
						event.payload.messageId,
						event.payload.token,
						"thought"
					)
				);
			case "ToolCallObserved":
				return Effect.succeed(this.onToolCallObserved(event.payload));
			case "ApprovalRequested":
				return Effect.succeed(this.onApprovalRequested(event.payload));
			case "InteractionReplied":
				return Effect.succeed(this.onInteractionReplied(event.payload, event.sequence));
			case "TurnCancelled":
				return Effect.succeed(
					this.onTurnCancelled(event.payload.sessionId, event.payload.turnId ?? null)
				);
			case "TurnCompleted":
				return Effect.succeed(
					this.onTurnCompleted(event.payload.sessionId, event.payload.turnId ?? null)
				);
			case "ProviderSessionFailed":
				return Effect.succeed(
					this.onProviderSessionFailed(
						event.payload.sessionId,
						event.payload.operation,
						event.payload.detail
					)
				);
			case "SessionModeSet":
				return Effect.succeed(this.onSessionModeSet(event.payload.sessionId, event.payload.modeId));
			case "SessionModelSet":
				return Effect.succeed(
					this.onSessionModelSet(event.payload.sessionId, event.payload.modelId)
				);
			case "SessionConfigOptionSet":
				return Effect.succeed(
					this.onSessionConfigOptionSet(
						event.payload.sessionId,
						event.payload.key,
						event.payload.value
					)
				);
			case "SessionMetaUpdated":
				return Effect.succeed(this.onSessionMetaUpdated(event.payload.sessionId, event.metadata));
			case "SessionArchived":
				return Effect.succeed(
					this.onSessionArchiveChanged(event.payload.sessionId, event.occurredAt)
				);
			case "SessionUnarchived":
				return Effect.succeed(this.onSessionArchiveChanged(event.payload.sessionId, null));
			case "TurnUsageObserved":
				return Effect.succeed(this.onTurnUsageObserved(event.payload));
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
				const state = freshSessionState();
				const revision = state.revision;
				this.sessions.set(sessionId, state);
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
							// A session's modes and models come from its provider, and
							// no event carries them. Seeding them here is what makes the
							// mode selector render at all (the toolbar hides it unless a
							// session reports modes) and what turns the model slot from a
							// static agent label into a picker.
							capabilities: providerSessionCapabilities(providerId),
						},
					},
				};
				return [toSessionStateAcpEnvelope(envelope)];
			})
		);
	}

	private onMessageSent(
		sessionId: string,
		messageId: string,
		text: string,
		occurredAt: string
	): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
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
		// AC-269: real turn start, parsed from the server's own event
		// timestamp -- see turnStartedAtMs's doc on SessionCanonicalState.
		const turnStartedAtMs = Date.parse(occurredAt);
		const activity = awaitingModelActivityAt(
			Number.isNaN(turnStartedAtMs) ? null : turnStartedAtMs
		);
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity,
			turnState: "Running",
			activeStreamingTail: null,
			transcriptOperations: operations,
			operationPatches: [],
			interactionPatches: [],
			changedFields,
		};
		state.revision = toRevision;
		state.turnState = "Running";
		state.activity = activity;
		state.turnStartedAtMs = Number.isNaN(turnStartedAtMs) ? null : turnStartedAtMs;
		state.assistantEntryId = null;
		state.assistantEntryRunSeq = 0;
		state.assistantSegmentSeq = 0;
		const envelopes = [toSessionStateAcpEnvelope(envelopeForDelta(sessionId, toRevision, delta))];
		// A new prompt attempt clears the auth park: if the account is still
		// signed out, the adapter raises the fact again on this very turn.
		if (state.authRequired) {
			state.authRequired = false;
			envelopes.push(this.lifecycleEnvelope(sessionId, state, false));
		}
		return envelopes;
	}

	/**
	 * One streamed slice of the assistant's output -- text (TokenAppended) and
	 * extended thinking (ThoughtAppended) share this fold because they differ
	 * only in segment kind: both grow the SAME assistant entry, matching the
	 * restored-session materializer contract of a single assistant entry with
	 * mixed thought/text segments (the assistant message component splits them
	 * into the thinking block and the reply itself).
	 */
	private onAssistantStreamAppended(
		sessionId: string,
		messageId: string,
		token: string,
		segmentKind: "text" | "thought"
	): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
		const toRevision = nextRevision(state.revision, true);
		const currentEntryId = state.assistantEntryId;
		const newEntryId =
			state.assistantEntryRunSeq === 0
				? `entry-assistant-${messageId}`
				: `entry-assistant-${messageId}-${String(state.assistantEntryRunSeq)}`;
		const operations: TranscriptDeltaOperation[] =
			currentEntryId === null
				? [
						{
							kind: "appendEntry",
							entry: {
								entryId: newEntryId,
								role: "assistant",
								segments: [{ kind: segmentKind, segmentId: `seg-${messageId}-0`, text: token }],
							},
						},
					]
				: [
						{
							kind: "appendSegment",
							entryId: currentEntryId,
							role: "assistant",
							segment: {
								kind: segmentKind,
								segmentId: `seg-${messageId}-${String(state.assistantSegmentSeq)}`,
								text: token,
							},
						},
					];
		// The entry this token lands in is the live tail. conversation-rebuild
		// marks an entry streaming by matching it against this rowId, and the
		// streaming reveal only animates that entry, so leaving it null makes
		// every reveal mode inert while the reply is still arriving. The
		// contentKind tells the reveal whether the tail is currently growing
		// its thinking block or the reply itself.
		const liveTailEntryId = currentEntryId ?? newEntryId;
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity: awaitingModelActivityAt(state.turnStartedAtMs),
			turnState: "Running",
			activeStreamingTail: {
				rowId: liveTailEntryId,
				contentKind: segmentKind === "thought" ? "thought" : "message",
			},
			transcriptOperations: operations,
			operationPatches: [],
			interactionPatches: [],
			changedFields: ["transcriptSnapshot", "activeStreamingTail"],
		};
		state.revision = toRevision;
		state.assistantEntryId = currentEntryId ?? newEntryId;
		state.assistantSegmentSeq += 1;
		return [toSessionStateAcpEnvelope(envelopeForDelta(sessionId, toRevision, delta))];
	}

	private onToolCallObserved(payload: {
		readonly sessionId: SessionId;
		readonly toolCallId: string;
		readonly status: "pending" | "in_progress" | "completed" | "failed";
		readonly title: string;
		readonly path: string | null;
		readonly output?: string | null;
		readonly kind?: string | null;
		readonly input?: Schema.JsonObject | null;
	}): AcpEventEnvelope[] {
		const state = this.stateFor(payload.sessionId);
		// A tool call is transcript-bearing only on first sighting -- that is
		// the one observation that actually appends a "tool" row
		// (transcriptOperations below). A later status-only re-observation
		// (pending -> in_progress -> completed) patches the existing operation
		// and carries zero transcriptOperations, so it must NOT claim
		// transcriptRevision advanced or list "transcriptSnapshot" in
		// changedFields: session-state-query-service.ts's resolveSessionStateDelta
		// treats "transcriptSnapshot changed with zero operations" as a stale/
		// desynced delta and forces a refreshSnapshot, which drops this same
		// delta's operationPatches/activity (routeSessionStateEnvelope only
		// emits applyGraphPatches on the non-refreshSnapshot path) and, because
		// this bridge's live transcript exists only client-side, permanently
		// desyncs every later envelope for the session -- the live transcript
		// stalls right after the first tool call and never renders the rest of
		// the turn. See orchestration-canonical-bridge.test.ts's
		// "keeps rendering after a tool call re-observes status" case.
		const isFirstSighting = !state.observedToolCallIds.has(payload.toolCallId);
		const toRevision = nextRevision(state.revision, isFirstSighting);
		const toolEntryId = `entry-tool-${payload.toolCallId}`;
		const transcriptOperations: TranscriptDeltaOperation[] = isFirstSighting
			? [
					{
						kind: "appendEntry",
						entry: {
							entryId: toolEntryId,
							role: "tool",
							segments: [
								{ kind: "text", segmentId: `seg-tool-${payload.toolCallId}`, text: payload.title },
							],
						},
					},
				]
			: [];
		if (isFirstSighting) {
			state.observedToolCallIds.add(payload.toolCallId);
			// A tool row splits the assistant reply around it: any text that
			// streamed before this tool call belongs to its own entry, and any
			// text that streams after it must start a new entry positioned after
			// the tool row in transcript order, not silently re-merge into the
			// entry that came before the tool call.
			if (state.assistantEntryId !== null) {
				state.assistantEntryRunSeq += 1;
			}
			state.assistantEntryId = null;
			state.assistantSegmentSeq = 0;
		}
		const operation: OperationSnapshot = {
			id: payload.toolCallId,
			session_id: payload.sessionId,
			tool_call_id: payload.toolCallId,
			name: payload.title,
			// Canonical: the provider's own classification the ToolCallObserved
			// event now carries, not a kind re-parsed from the display title.
			kind: asOperationToolKind(payload.kind),
			provider_status: observedStatusToToolCallStatus(payload.status),
			title: payload.title,
			arguments: toolArgumentsFromCanonical(payload.input, payload.kind),
			progressive_arguments: null,
			// #273: the tool's own result, canonical on the observation itself.
			// transcript-viewport-row-mapper.ts already renders it through
			// jsonValueTextSummary(operation.result) as the row's stdout and
			// resultSummary -- this bridge hardcoded null, so it never had one.
			result: payload.output ?? null,
			command: null,
			normalized_todos: null,
			parent_tool_call_id: null,
			parent_operation_id: null,
			child_tool_call_ids: [],
			child_operation_ids: [],
			operation_state: observedStatusToOperationState(payload.status),
			locations: payload.path === null ? null : [{ path: payload.path }],
			awaiting_plan_approval: false,
			source_link: { kind: "transcript_linked", entry_id: toolEntryId },
		};
		const isTerminalObservation = payload.status === "completed" || payload.status === "failed";
		if (isTerminalObservation) {
			state.openOperations.delete(payload.toolCallId);
		} else {
			state.openOperations.set(payload.toolCallId, operation);
		}
		const activity: SessionGraphActivity = isTerminalObservation
			? awaitingModelActivityAt(state.turnStartedAtMs)
			: {
					kind: "running_operation",
					activeOperationCount: 1,
					activeSubagentCount: 0,
					dominantOperationId: operation.id,
				};
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity,
			turnState: state.turnState,
			activeStreamingTail: null,
			transcriptOperations,
			operationPatches: [operation],
			interactionPatches: [],
			changedFields: isFirstSighting
				? ["transcriptSnapshot", "operations", "activity"]
				: ["operations", "activity"],
		};
		state.revision = toRevision;
		state.activity = activity;
		return [toSessionStateAcpEnvelope(envelopeForDelta(payload.sessionId, toRevision, delta))];
	}

	// AC-280: a real permission id is always perm-<toolCallId> (see
	// permissionIdForToolCall in the server's Claude/Cursor/Copilot Tools.ts).
	// Claude reports the tool call itself (ToolCallObserved) before it blocks
	// on permission for it -- the normal live order, confirmed against a real
	// session's own DB (one projection_session_activities row, one
	// perm-<sameToolCallId> pending approval) -- so by the time
	// ApprovalRequested arrives, a transcript row for that exact tool call
	// usually already exists. Attach to it instead of minting a second,
	// duplicate row: one tool call must render as one row, not two.
	private onApprovalRequested(payload: {
		readonly sessionId: SessionId;
		readonly approvalRequestId: string;
		readonly title: string;
	}): AcpEventEnvelope[] {
		const state = this.stateFor(payload.sessionId);
		const existingToolCallId = existingRowToolCallIdForApproval(state, payload.approvalRequestId);
		if (existingToolCallId !== null) {
			return this.onApprovalRequestedForExistingRow(state, payload, existingToolCallId);
		}
		return this.onApprovalRequestedAsStandaloneRow(state, payload);
	}

	// The approval's own row already exists as a tool-call row -- patch the
	// interaction's tool reference onto that row's real toolCallId so
	// getForToolCall (permission-store.svelte.ts, wired in
	// transcript-viewport-row-renderer.svelte) attaches Allow/Always/Deny to
	// it directly. No transcriptOperations, no operationPatches: the row is
	// already there, appending another would duplicate it.
	private onApprovalRequestedForExistingRow(
		state: SessionCanonicalState,
		payload: {
			readonly sessionId: SessionId;
			readonly approvalRequestId: string;
			readonly title: string;
		},
		toolCallId: string
	): AcpEventEnvelope[] {
		state.observedApprovalIds.add(payload.approvalRequestId);
		state.pendingApprovals.set(payload.approvalRequestId, {
			toolCallId,
			title: payload.title,
		});
		const toRevision = nextRevision(state.revision, false);
		const interaction: InteractionSnapshot = {
			id: payload.approvalRequestId,
			session_id: payload.sessionId,
			kind: "Permission",
			state: "Pending",
			json_rpc_request_id: null,
			reply_handler: null,
			tool_reference: { callId: toolCallId },
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
					tool: { callId: toolCallId },
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

	// #268 defect 2: ApprovalRequested used to patch session.interactions ONLY
	// -- zero transcriptOperations, so nothing ever appeared in the transcript
	// (the same "operation patched, no visible row" bug tool calls had before
	// AC-263 -- see onToolCallObserved's doc). A pending approval with no
	// existing tool-call row to attach to is transcript-bearing on first
	// sighting: it appends its own "tool"-role row and stamps that same row's
	// id onto interaction.payload.Permission.tool.callId, so the existing
	// tool-call-attached PermissionBar (getForToolCall in permission-store
	// .svelte.ts, wired in transcript-viewport-row-renderer.svelte) renders
	// Allow/Always/Deny directly under the row instead of the request going
	// nowhere.
	private onApprovalRequestedAsStandaloneRow(
		state: SessionCanonicalState,
		payload: {
			readonly sessionId: SessionId;
			readonly approvalRequestId: string;
			readonly title: string;
		}
	): AcpEventEnvelope[] {
		const isFirstSighting = !state.observedApprovalIds.has(payload.approvalRequestId);
		const toRevision = nextRevision(state.revision, isFirstSighting);
		const approvalEntryId = `entry-approval-${payload.approvalRequestId}`;
		const transcriptOperations: TranscriptDeltaOperation[] = isFirstSighting
			? [
					{
						kind: "appendEntry",
						entry: {
							entryId: approvalEntryId,
							role: "tool",
							segments: [
								{
									kind: "text",
									segmentId: `seg-approval-${payload.approvalRequestId}`,
									text: payload.title,
								},
							],
						},
					},
				]
			: [];
		if (isFirstSighting) {
			state.observedApprovalIds.add(payload.approvalRequestId);
		}
		state.pendingApprovals.set(payload.approvalRequestId, {
			toolCallId: payload.approvalRequestId,
			title: payload.title,
		});
		const operation: OperationSnapshot = {
			id: payload.approvalRequestId,
			session_id: payload.sessionId,
			tool_call_id: payload.approvalRequestId,
			name: payload.title,
			kind: null,
			provider_status: observedStatusToToolCallStatus("pending"),
			title: payload.title,
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
			source_link: { kind: "transcript_linked", entry_id: approvalEntryId },
		};
		state.openOperations.set(operation.tool_call_id, operation);
		const interaction: InteractionSnapshot = {
			id: payload.approvalRequestId,
			session_id: payload.sessionId,
			kind: "Permission",
			state: "Pending",
			json_rpc_request_id: null,
			reply_handler: null,
			tool_reference: { callId: payload.approvalRequestId },
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
					tool: { callId: payload.approvalRequestId },
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
			transcriptOperations,
			operationPatches: [operation],
			interactionPatches: [interaction],
			changedFields: isFirstSighting
				? ["transcriptSnapshot", "operations", "interactions", "activity"]
				: ["operations", "interactions", "activity"],
		};
		state.revision = toRevision;
		state.activity = activity;
		return [toSessionStateAcpEnvelope(envelopeForDelta(payload.sessionId, toRevision, delta))];
	}

	// The canonical answer to an approval. By the time this arrives the server
	// has already dropped the pending row (ProjectionPendingApprovals, and the
	// snapshot fold in packages/contracts/src/sessionSnapshot.ts), so the
	// client's own interaction graph has to resolve it from the same event:
	// interaction-store.svelte.ts's applyPermissionInteraction deletes any
	// permission whose state is not "Pending", and that is what takes the
	// PermissionBar off the row. Without this case the bridge dropped the event
	// and the only thing that ever cleared a permission was permission-store's
	// optimistic local delete, which fires only for the click that made it --
	// so an approval answered anywhere else, or a delivery the click path
	// missed, left "Permission Required" and "Waiting for your approval" on a
	// tool call the provider had already finished.
	private onInteractionReplied(
		payload: {
			readonly sessionId: SessionId;
			readonly approvalRequestId: string;
			readonly decision: ApprovalDecision;
		},
		eventSeq: number
	): AcpEventEnvelope[] {
		const state = this.stateFor(payload.sessionId);
		const record = state.pendingApprovals.get(payload.approvalRequestId);
		state.pendingApprovals.delete(payload.approvalRequestId);
		// A session reopened while an approval was still open seeds that
		// permission from the snapshot, which keys the tool reference on the
		// approval id itself (interactionFromPendingApproval in
		// reopen-snapshot-graph.ts). Resolve with the same shape when this
		// bridge never saw the request, so a reopened session clears too.
		const toolCallId = record === undefined ? payload.approvalRequestId : record.toolCallId;
		const title = record === undefined ? RESOLVED_APPROVAL_FALLBACK_TITLE : record.title;
		const accepted = payload.decision === "allow";
		const toRevision = nextRevision(state.revision, false);
		const interaction: InteractionSnapshot = {
			id: payload.approvalRequestId,
			session_id: payload.sessionId,
			kind: "Permission",
			state: accepted ? "Approved" : "Rejected",
			json_rpc_request_id: null,
			reply_handler: null,
			tool_reference: { callId: toolCallId },
			responded_at_event_seq: eventSeq,
			response: { kind: "permission", accepted },
			payload: {
				Permission: {
					id: payload.approvalRequestId,
					sessionId: payload.sessionId,
					permission: title,
					patterns: [],
					metadata: null,
					always: [],
					autoAccepted: false,
					tool: { callId: toolCallId },
				},
			},
		};
		// A standalone approval hosts its own OperationSnapshot (the row minted
		// in onApprovalRequestedAsStandaloneRow, pending so the card renders as
		// waiting). The answer settles that operation too, or the row keeps its
		// spinner after the bar is gone. An approval attached to a real tool
		// call is different: the provider keeps reporting that tool call itself
		// (ToolCallObserved in_progress -> completed), so the answer must not
		// pre-empt it.
		const standaloneOperation =
			toolCallId === payload.approvalRequestId ? state.openOperations.get(toolCallId) : undefined;
		const operationPatches: OperationSnapshot[] = [];
		if (standaloneOperation !== undefined) {
			state.openOperations.delete(toolCallId);
			operationPatches.push({
				...standaloneOperation,
				operation_state: accepted ? "completed" : "cancelled",
			});
		}
		// Only this approval's own block is released. A session waiting on a
		// different interaction stays waiting on it.
		const releasesActivity =
			state.activity.kind === "waiting_for_user" &&
			state.activity.blockingInteractionId === payload.approvalRequestId;
		const activity = releasesActivity
			? awaitingModelActivityAt(state.turnStartedAtMs)
			: state.activity;
		const changedFields: SessionStateField[] = releasesActivity
			? ["interactions", "activity"]
			: ["interactions"];
		if (operationPatches.length > 0) {
			changedFields.push("operations");
		}
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity,
			turnState: state.turnState,
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches,
			interactionPatches: [interaction],
			changedFields,
		};
		state.revision = toRevision;
		state.activity = activity;
		return [toSessionStateAcpEnvelope(envelopeForDelta(payload.sessionId, toRevision, delta))];
	}

	// #283: the canonical current mode, live. The server already folds every
	// SessionModeSet into ProjectionSessions.current_mode_id and hands it over
	// on reopen (RpcProjectedSession.currentModeId -> reopen-snapshot-graph
	// .ts's capabilitiesFromSnapshot), so a reopened session reported the right
	// mode while a running one did not: this event fell into translate's
	// default branch and nothing ever reached capabilities.modes.currentModeId
	// mid-run.
	//
	// It rides its own narrow "sessionMode" envelope kind because the only
	// other way capabilities reach the store is whole: a graph on a "snapshot"
	// envelope, which SessionEnvelopeApplier sanitizes and writes in one go.
	// Sending a mode that way would have restated the models, the commands and
	// the config options this bridge does not know mid-run. The mode does spend
	// a graph revision, unlike a usage reading: the client adopts it onto both
	// the canonical projection and the graph, so its frontier has to move with
	// the server's.
	//
	// The transcript revision stays put. A mode change appends no row, and
	// session-state-query-service.ts reads a transcript revision that advanced
	// with nothing to apply as a desync.
	private onSessionModeSet(sessionId: string, modeId: string): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
		const toRevision = nextRevision(state.revision, false);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: toRevision.graphRevision,
			lastEventSeq: toRevision.lastEventSeq,
			payload: { kind: "sessionMode", currentModeId: modeId, revision: toRevision },
		};
		state.revision = toRevision;
		return [toSessionStateAcpEnvelope(envelope)];
	}

	// The model half of onSessionModeSet above, and the reason picking a model
	// now means something live: SessionModelSet used to fall into translate's
	// default branch, so the composer's own optimistic label was the only place
	// a chosen model existed.
	private onSessionModelSet(sessionId: string, modelId: string): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
		const toRevision = nextRevision(state.revision, false);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: toRevision.graphRevision,
			lastEventSeq: toRevision.lastEventSeq,
			payload: { kind: "sessionModel", currentModelId: modelId, revision: toRevision },
		};
		state.revision = toRevision;
		return [toSessionStateAcpEnvelope(envelope)];
	}

	// The config-option third of onSessionModeSet above, and the last of the
	// three composer selections to go live: SessionConfigOptionSet used to fall
	// into translate's default branch, so a reasoning effort chosen mid-run
	// existed only in the composer's provisional overlay until the next reopen
	// read the server's folded config_options. The envelope carries the one
	// key/value fact; pairing it with the provider's option catalog is the
	// store fold's job (capabilities-with-session-config-option.ts), the same
	// split the reopen path uses.
	private onSessionConfigOptionSet(
		sessionId: string,
		configId: string,
		value: string
	): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
		const toRevision = nextRevision(state.revision, false);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: toRevision.graphRevision,
			lastEventSeq: toRevision.lastEventSeq,
			payload: { kind: "sessionConfigOption", configId, value, revision: toRevision },
		};
		state.revision = toRevision;
		return [toSessionStateAcpEnvelope(envelope)];
	}


	// The session's lifecycle, spent one revision at a time. The auth park is
	// the "detached awaiting authentication" state the lifecycle contract
	// already documents ("parked awaiting user action ... rendered as a
	// neutral sign-in card"), and the accessor the sign-in card reads
	// (getSessionLifecycleDetachedReason) only answers for that status. The
	// composer stays usable on purpose -- canSend stays true, because a new
	// prompt attempt IS the recovery path once the sign-in completed, and a
	// still-signed-out account simply re-raises the fact.
	private lifecycleEnvelope(
		sessionId: string,
		state: SessionCanonicalState,
		awaitingAuthentication: boolean
	): AcpEventEnvelope {
		const toRevision = nextRevision(state.revision, false);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: toRevision.graphRevision,
			lastEventSeq: toRevision.lastEventSeq,
			payload: {
				kind: "lifecycle",
				lifecycle: awaitingAuthentication
					? {
							status: "detached",
							detachedReason: "awaitingAuthentication",
							actionability: {
								canSend: true,
								canResume: true,
								canRetry: false,
								canArchive: true,
								canConfigure: true,
								recommendedAction: "none",
								recoveryPhase: "none",
								compactStatus: "detached",
							},
						}
					: {
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
				revision: toRevision,
			},
		};
		state.revision = toRevision;
		return toSessionStateAcpEnvelope(envelope);
	}

	// The provider's own model catalog, published as a session_models fact on a
	// SessionMetaUpdated event's metadata -- the same channel every adapter
	// already uses for the provider_session fact. Most meta updates carry no
	// catalog, and those produce nothing: emitting an empty one would spend a
	// graph revision to say nothing, and would empty the picker on every title
	// change.
	private onSessionMetaUpdated(
		sessionId: string,
		metadata: OrchestrationEvent["metadata"]
	): AcpEventEnvelope[] {
		if (sessionAuthRequiredFromMetadata(metadata)) {
			const state = this.stateFor(sessionId);
			state.authRequired = true;
			return [this.lifecycleEnvelope(sessionId, state, true)];
		}
		const models = sessionModelsFromMetadata(metadata);
		if (models === null) {
			return [];
		}
		const state = this.stateFor(sessionId);
		const toRevision = nextRevision(state.revision, false);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: toRevision.graphRevision,
			lastEventSeq: toRevision.lastEventSeq,
			payload: {
				kind: "sessionModels",
				availableModels: models.map((model) => ({
					modelId: model.modelId,
					name: model.name,
					description: model.description,
				})),
				revision: toRevision,
			},
		};
		state.revision = toRevision;
		return [toSessionStateAcpEnvelope(envelope)];
	}

	/**
	 * Archived-ness, live.
	 *
	 * The server owns `archived_at` and commits SessionArchived /
	 * SessionUnarchived when it changes. Without this the fact only reached the
	 * app through the library snapshot, so the two components that dispatch the
	 * command had to fetch that whole snapshot back to move one boolean, and any
	 * other client archiving the same session left this one showing a row the
	 * backend had already stopped running.
	 *
	 * The envelope spends no revision. `archivedAt` lives on the SessionCold row
	 * the session list holds, not on the session graph, so advancing the graph
	 * revision here would make session-state-query-service.ts read a frontier
	 * that moved with nothing to apply. The header carries the session's current
	 * revision, which the ingress frontier check accepts as not-older.
	 *
	 * `SessionUnarchived` carries no timestamp to clear to, so it passes null
	 * and the row's `archivedAt` goes back to null -- the same shape the library
	 * projection produces for a session that was never archived.
	 */
	private onSessionArchiveChanged(
		sessionId: string,
		archivedAt: string | null
	): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: state.revision.graphRevision,
			lastEventSeq: state.revision.lastEventSeq,
			payload: { kind: "sessionArchive", archivedAtMs: archivedAtMsFrom(archivedAt) },
		};
		return [toSessionStateAcpEnvelope(envelope)];
	}

	// AC-269: routes a real usage reading onto the EXISTING "telemetry"
	// envelope kind / applyTelemetry command / setUsageTelemetry patch chain
	// (reduce-command.ts's reduceApplyTelemetry -> canonical-usage-telemetry.ts's
	// buildCanonicalUsageTelemetry -> SessionTransientProjection.usageTelemetry)
	// rather than inventing a new one -- that pipeline already exists (built
	// for the model-selector metrics chip) but nothing ever produced a live
	// "telemetry" envelope for it until this fix, so usageTelemetry was
	// permanently null/stale in the real app. totalTokens is derived from
	// input+output when the fact did not carry one itself (never a fabricated
	// guess -- only a real sum of two real readings): buildCanonicalUsageTelemetry
	// only treats a reading as a fresh occupancy snapshot when tokens.total is
	// present, so a cost-only or malformed reading correctly leaves the
	// working line's token display untouched instead of overwriting it with
	// nothing.
	private onTurnUsageObserved(payload: {
		readonly sessionId: SessionId;
		readonly turnId?: string;
		readonly eventId?: string | null;
		readonly inputTokens?: number;
		readonly outputTokens?: number;
		readonly totalTokens?: number;
		readonly cacheReadTokens?: number;
		readonly cacheWriteTokens?: number;
		readonly costUsd?: number;
		readonly contextWindowSize?: number;
	}): AcpEventEnvelope[] {
		const state = this.stateFor(payload.sessionId);
		// A usage reading rides the session's current revision rather than
		// spending one. Nothing downstream adopts a telemetry envelope's
		// revision -- it carries no graph state to apply -- so advancing here
		// left the client one behind for the rest of the session: every later
		// delta started at a revision the client had never reached, the router
		// read that as a frontier mismatch, and the transcript stopped applying
		// anything. A revision is spent only when something the client can
		// adopt changes.
		const toRevision = state.revision;
		const derivedTotal =
			payload.totalTokens ??
			(payload.inputTokens !== undefined && payload.outputTokens !== undefined
				? payload.inputTokens + payload.outputTokens
				: undefined);
		const hasTokenReading =
			payload.inputTokens !== undefined ||
			payload.outputTokens !== undefined ||
			derivedTotal !== undefined ||
			payload.cacheReadTokens !== undefined ||
			payload.cacheWriteTokens !== undefined;
		const telemetry: UsageTelemetryData = {
			sessionId: payload.sessionId,
			// #274: the reading's own deterministic id, so
			// canonical-usage-telemetry.ts's lastTelemetryEventId dedup finally
			// has a key to compare. Null when the provider minted no id, which
			// that dedup reads as "always apply" -- the behaviour every provider
			// had while this field was never set at all.
			eventId: payload.eventId ?? null,
			...(hasTokenReading
				? {
						tokens: {
							...(payload.inputTokens !== undefined ? { input: payload.inputTokens } : {}),
							...(payload.outputTokens !== undefined ? { output: payload.outputTokens } : {}),
							...(derivedTotal !== undefined ? { total: derivedTotal } : {}),
							...(payload.cacheReadTokens !== undefined
								? { cacheRead: payload.cacheReadTokens }
								: {}),
							...(payload.cacheWriteTokens !== undefined
								? { cacheWrite: payload.cacheWriteTokens }
								: {}),
						},
					}
				: {}),
			...(payload.costUsd !== undefined ? { costUsd: payload.costUsd } : {}),
			...(payload.contextWindowSize !== undefined
				? { contextWindowSize: payload.contextWindowSize, contextWindowSource: "provider-explicit" }
				: {}),
		};
		const envelope: SessionStateEnvelope = {
			sessionId: payload.sessionId,
			graphRevision: toRevision.graphRevision,
			lastEventSeq: toRevision.lastEventSeq,
			payload: { kind: "telemetry", telemetry, revision: toRevision },
		};
		return [toSessionStateAcpEnvelope(envelope)];
	}

	/**
	 * Closes the open turn on a terminal signal.
	 *
	 * Cancelled, failed and completed differ only in the turn state they land
	 * on and whether they carry a failure, so one place decides what closing a
	 * turn means.
	 *
	 * A terminal turn also settles everything still open inside it. An
	 * operation the provider left pending/in_progress (a Bash approval nobody
	 * answered, then the provider gave the turn up -- the live hang this
	 * repairs) can never advance once the turn is over, so it settles to
	 * cancelled (failed when the turn itself failed), and every unanswered
	 * approval resolves as Unresolved so the PermissionBar stops asking a
	 * question no one can answer any more.
	 */
	private endTurn(
		sessionId: string,
		turnState: SessionTurnState,
		failure: TurnFailureSnapshot | null
	): AcpEventEnvelope[] {
		const state = this.stateFor(sessionId);
		const toRevision = nextRevision(state.revision, false);
		// operation_state is the canonical decision surface; provider_status is
		// provenance and stays whatever the provider last reported -- it never
		// reported terminal, and settling must not fake that it did.
		const settledState: OperationState = turnState === "Failed" ? "failed" : "cancelled";
		const operationPatches = Array.from(state.openOperations.values(), (operation) => ({
			...operation,
			operation_state: settledState,
		}));
		const interactionPatches = Array.from(state.pendingApprovals, ([approvalRequestId, record]) =>
			this.unresolvedApprovalInteraction(sessionId, approvalRequestId, record)
		);
		state.openOperations.clear();
		state.pendingApprovals.clear();
		const changedFields: SessionStateField[] = ["turnState", "activity", "activeStreamingTail"];
		if (failure !== null) {
			changedFields.push("activeTurnFailure");
		}
		if (operationPatches.length > 0) {
			changedFields.push("operations");
		}
		if (interactionPatches.length > 0) {
			changedFields.push("interactions");
		}
		const delta: SessionStateDelta = {
			fromRevision: state.revision,
			toRevision,
			activity: idleActivity,
			turnState,
			...(failure === null ? {} : { activeTurnFailure: failure }),
			activeStreamingTail: null,
			transcriptOperations: [],
			operationPatches,
			interactionPatches,
			changedFields,
		};
		state.revision = toRevision;
		state.turnState = turnState;
		state.activity = idleActivity;
		state.turnStartedAtMs = null;
		state.assistantEntryId = null;
		state.assistantEntryRunSeq = 0;
		return [toSessionStateAcpEnvelope(envelopeForDelta(sessionId, toRevision, delta))];
	}

	// An approval the turn ended on with no answer. "Unresolved" is the honest
	// state -- nobody approved and nobody rejected -- and any non-"Pending"
	// state is what takes the PermissionBar off the row (interaction-store
	// .svelte.ts's applyPermissionInteraction).
	private unresolvedApprovalInteraction(
		sessionId: string,
		approvalRequestId: string,
		record: PendingApprovalRecord
	): InteractionSnapshot {
		return {
			id: approvalRequestId,
			session_id: sessionId,
			kind: "Permission",
			state: "Unresolved",
			json_rpc_request_id: null,
			reply_handler: null,
			tool_reference: { callId: record.toolCallId },
			responded_at_event_seq: null,
			response: null,
			payload: {
				Permission: {
					id: approvalRequestId,
					sessionId,
					permission: record.title,
					patterns: [],
					metadata: null,
					always: [],
					autoAccepted: false,
					tool: { callId: record.toolCallId },
				},
			},
		};
	}

	private onTurnCancelled(sessionId: string, _turnId: string | null): AcpEventEnvelope[] {
		return this.endTurn(sessionId, "Cancelled", null);
	}

	/**
	 * A dead provider adapter ends the open turn.
	 *
	 * ProviderBridge emits ProviderSessionFailed when a real adapter's event
	 * stream dies, and nothing else on the contract reports a failed turn. Left
	 * untranslated, the session's canonical turnState stayed "Running" forever:
	 * the composer kept showing work in progress, and anything waiting on the
	 * turn (the ship card's hidden session, for one) waited until its own
	 * timeout instead of learning the turn was over.
	 */
	private onProviderSessionFailed(
		sessionId: string,
		operation: ProviderOperation,
		detail: string
	): AcpEventEnvelope[] {
		return this.endTurn(sessionId, "Failed", {
			turn_id: null,
			message: detail,
			details: `provider operation: ${operation}`,
			kind: "fatal",
			source: "transport",
		});
	}

	private onTurnCompleted(sessionId: string, _turnId: string | null): AcpEventEnvelope[] {
		return this.endTurn(sessionId, "Completed", null);
	}
}

let acpEnvelopeSeq = 0;

/**
 * The instant an archive took effect, in ms.
 *
 * Null stays null: that is an unarchive, and the row goes back to the shape a
 * session that was never archived has. An archive whose `occurredAt` will not
 * parse falls back to now rather than to null -- the session IS archived, and
 * reporting a slightly wrong instant is better than reporting a row the backend
 * has stopped running as still live.
 */
function archivedAtMsFrom(archivedAt: string | null): number | null {
	if (archivedAt === null) {
		return null;
	}
	const parsed = Date.parse(archivedAt);
	return Number.isNaN(parsed) ? Date.now() : parsed;
}

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
				const snapshot = yield* client.snapshot(librarySnapshotRequest()).pipe(
					Effect.orElseSucceed(() => ({
						projects: [] as ReadonlyArray<{ projectId: string; workspaceRoot: string }>,
					}))
				);
				cache = new Map(
					snapshot.projects.map((project) => [project.projectId, project.workspaceRoot])
				);
			}
			return cache.get(projectId) ?? "";
		});
}
