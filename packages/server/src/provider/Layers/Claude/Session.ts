import {
	ActivityId,
	ApprovalRequestedEvent,
	ApprovalRequestId,
	CommandId,
	EventId,
	MessageId,
	MessageSentEvent,
	type ObservedToolStatus,
	type OrchestrationEvent,
	SessionId,
	SessionMetaUpdatedEvent,
	TokenAppendedEvent,
	ToolCallId,
	ToolCallObservedEvent,
	TurnCancelledEvent,
	TurnCompletedEvent,
	TurnId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type { ProviderAdapterError, SendPromptRequest } from "../../Services/ProviderAdapter.ts"
import { encodeContractFact } from "./Codec.ts"
import type { ClaudeContractFact } from "./Facts.ts"
import { mapSdkMessage, toolCallPathHint, type ClaudeStreamState } from "./Map.ts"
import type { ClaudePermissionDecision } from "./Permissions.ts"
import { adapterError, type ClaudeQueryHandle, type ClaudeUserPrompt } from "./Process.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}

// What a "tool_call" fact recorded about a tool call, kept around so the
// LATER "tool_call_update" fact (which carries only toolCallId + a new
// status -- see ToolCallUpdateFact in Map.ts) can still publish a
// complete ToolCallObservedEvent: the projector's ToolCallObservedPayload
// requires a title on every row, not just the first one -- see
// ProjectionSessionActivities.ts's observedToolRow.
export type OpenToolCallInfo = {
	readonly activityId: ActivityId
	readonly title: string
	readonly path: string | null
}

// One projection_session_activities row per Claude tool_use block, keyed the
// same way across its whole lifecycle (start -> completed/failed) so the
// projector's merge sees one growing row instead of two unrelated ones. The
// SDK's own toolCallId is already unique per call, so deriving activityId
// from it (rather than minting a fresh one) is enough -- no separate id
// needs to round-trip through the SDK boundary.
const toolCallActivityId = (toolCallId: string): ActivityId => ActivityId.make(`${toolCallId}:activity`)

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly workspaceRoot: string
	// Epoch-ms captured ONCE when openSession builds this runtime -- see
	// stamp()'s use of it below for why. Deliberately NOT reset by attachQuery
	// (cancel/watchdog recovery reuse the SAME runtime and its sequence
	// counter keeps incrementing correctly); it only differs across a genuine
	// process restart, which is exactly the case that matters.
	readonly openEpochMs: number
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly streamState: Ref.Ref<ClaudeStreamState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<ClaudePermissionDecision>>
	>
	// Keyed by the SDK's own toolCallId. See OpenToolCallInfo's doc above.
	readonly openToolCalls: Ref.Ref<HashMap.HashMap<string, OpenToolCallInfo>>
	// The query a sendPrompt call feeds and a stream listener drains. Both are
	// swapped together by attachQuery whenever a session recovers from a
	// cancel or a watchdog-detected stall, so sendPrompt/cancelTurn always
	// read the CURRENT one rather than a query that may already be dead.
	readonly promptQueueRef: Ref.Ref<Queue.Queue<ClaudeUserPrompt, Done>>
	readonly queryRef: Ref.Ref<ClaudeQueryHandle>
	// Bumped by every attachQuery call. A query-listener fiber compares its
	// OWN captured generation against this at teardown time: a mismatch means
	// a newer query has since been attached (a deliberate restart, not a real
	// death), so the listener must skip the "session is gone" cleanup — see
	// attachQuery.
	readonly generation: Ref.Ref<number>
	// Epoch-ms when the CURRENTLY open turn started (sendPrompt), or None
	// when no turn is open — the watchdog only ever acts while a turn is
	// open. Cleared by publishFact on turn_complete/turn_error (including the
	// watchdog's own synthesized one) and by cancelTurn.
	readonly turnOpenedAtMs: Ref.Ref<Option.Option<number>>
	// Epoch-ms of the most recent provider stream activity — reset on every
	// raw SDK message AND whenever a prompt is sent, so the watchdog measures
	// silence, not merely "time since the turn opened".
	readonly lastActivityAtMs: Ref.Ref<number>
	// Set by cancelTurn once it has torn the query down; sendPrompt checks
	// this before offering into promptQueueRef and, if set, attaches a fresh
	// query FIRST. cancelTurn itself deliberately does NOT reattach eagerly —
	// a cancel with no follow-up (the user walked away, or a caller like a
	// test only cancelling for cleanup) would otherwise spawn a real `claude`
	// subprocess nobody asked for, exactly the kind of unconditional respawn
	// Defect D's fix already ruled out at the ProviderBridge level. The
	// watchdog, in contrast, DOES reattach eagerly (see watchdogLoop) — a
	// wedged turn always needs the session usable again immediately, there is
	// no "maybe nobody needs it" case for a stall the operator never asked
	// for.
	readonly needsReattach: Ref.Ref<boolean>
	// An explicit, non-fiber-structural scope that owns every query-listener
	// and the watchdog fiber for this session's whole lifetime, independent
	// of which caller's fiber happens to invoke attachQuery (openSession's
	// own fiber for the first attach, but ProviderBridge's shared dispatcher
	// fiber for a cancel-triggered restart, or the watchdog's own fiber for a
	// stall-triggered one) — see openSession and attachQuery.
	readonly sessionScope: Scope.Closeable
}

const assistantMessageId = (
	sessionId: SessionId,
	lastUser: Option.Option<MessageId>
): MessageId =>
	Option.match(lastUser, {
		onNone: () => MessageId.make(`${sessionId}:assistant`),
		onSome: tracerAssistantMessageId
	})

const nextSequence = (runtime: SessionRuntime) =>
	Ref.updateAndGet(runtime.sequence, (current) => current + 1)

// eventId/commandId are stamped as sessionId:openEpochMs:sequence, NOT bare
// sessionId:sequence -- DEFECT D (reproduced live): a session lazily reopened
// after a real app restart gets a BRAND NEW SessionRuntime whose `sequence`
// Ref starts over at 0 (see openSession below), so a bare sessionId:sequence
// scheme re-derives the SAME eventIds the PRIOR process already committed
// for that session's real conversation history, and the store's
// UNIQUE(event_id) constraint rejects the append -- surfacing as
// ProviderSessionFailed and leaving the session's ClaudeAdapter-side runtime
// registered but un-forwarded, i.e. silently poisoned: every later
// sendPrompt on it just hangs (MessageSent commits, nothing else ever does).
// openEpochMs is real wall-clock time captured once when the runtime is
// built, so a genuine restart (which takes measurable time) can never
// collide with the epoch a prior process used for the same session, while a
// cancel/watchdog recovery (attachQuery reusing the SAME runtime, sequence
// still incrementing) is unaffected -- it never changes epoch mid-runtime.
const stamp = Effect.fn("ClaudeAdapter.stamp")(function*(runtime: SessionRuntime) {
	const sequence = yield* nextSequence(runtime)
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const commandId = CommandId.make(`${runtime.sessionId}:${runtime.openEpochMs}:cmd:${sequence}`)
	return {
		sequence,
		eventId: EventId.make(`${runtime.sessionId}:${runtime.openEpochMs}:${sequence}`),
		occurredAt,
		commandId
	}
})

export const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
	Queue.offer(runtime.outbound, event).pipe(Effect.asVoid)

const makeTokenEvent = Effect.fn("ClaudeAdapter.makeTokenEvent")(function*(
	runtime: SessionRuntime,
	token: string
) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	return TokenAppendedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TokenAppended",
		payload: {
			sessionId: runtime.sessionId,
			messageId: assistantMessageId(runtime.sessionId, lastUser),
			token
		}
	})
})

export const makeMetaEvent = Effect.fn("ClaudeAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: ClaudeContractFact
) {
	const header = yield* stamp(runtime)
	const metadata = Option.getOrElse(encodeContractFact(fact), () => EMPTY_JSON_OBJECT)
	return SessionMetaUpdatedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata,
		type: "SessionMetaUpdated",
		payload: {
			sessionId: runtime.sessionId
		}
	})
})

export const makeMessageSent = Effect.fn("ClaudeAdapter.makeMessageSent")(function*(
	runtime: SessionRuntime,
	request: SendPromptRequest
) {
	const header = yield* stamp(runtime)
	return MessageSentEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "MessageSent",
		payload: {
			sessionId: runtime.sessionId,
			messageId: request.messageId,
			text: request.text
		}
	})
})

export const makeCancelled = Effect.fn("ClaudeAdapter.makeCancelled")(function*(
	runtime: SessionRuntime
) {
	const header = yield* stamp(runtime)
	return TurnCancelledEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TurnCancelled",
		payload: {
			sessionId: runtime.sessionId
		}
	})
})

// The SDK's own turn-end signal is its `result` message, which
// ClaudeSdkMap.mapSdkMessage already turns into a turn_complete (or
// turn_error) fact. That fact is the ONLY thing that closes an open
// projection_turns row absent a follow-up TurnCancelled or the next
// MessageSent starting a new turn — see ProjectionTurns.ts's
// evolveProjectedTurns. turn_error still closes the turn (rather than
// leaving it "running" forever): projection_turns has no separate "failed"
// status yet, so an errored turn is recorded as completed. Distinguishing
// success from failure in the projection is a follow-up, not something this
// fix invents room for.
const makeCompleted = Effect.fn("ClaudeAdapter.makeCompleted")(function*(runtime: SessionRuntime) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	return TurnCompletedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TurnCompleted",
		payload: Option.match(lastUser, {
			onNone: () => ({ sessionId: runtime.sessionId }),
			onSome: (userMessageId) => ({
				sessionId: runtime.sessionId,
				turnId: TurnId.make(userMessageId)
			})
		})
	})
})

// Builds the SAME contract event the tracer's ToolCallObserveCommand decider
// produces (see decider.ts's "tool.call.observe" case) -- ProjectionSessionActivities.ts
// only knows how to turn a ToolCallObserved event into a
// projection_session_activities row; a real Claude tool call folded into a
// generic SessionMetaUpdated (the bug this fixes) is invisible to that
// projector no matter what its encoded metadata says.
const makeToolCallObserved = Effect.fn("ClaudeAdapter.makeToolCallObserved")(function*(
	runtime: SessionRuntime,
	input: {
		readonly activityId: ActivityId
		readonly toolCallId: string
		readonly status: ObservedToolStatus
		readonly title: string
		readonly path: string | null
	}
) {
	const header = yield* stamp(runtime)
	return ToolCallObservedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ToolCallObserved",
		payload: {
			sessionId: runtime.sessionId,
			activityId: input.activityId,
			toolCallId: ToolCallId.make(input.toolCallId),
			operationId: null,
			status: input.status,
			title: input.title,
			path: input.path
		}
	})
})

// A tool_call_update fact that arrives with no cached start info -- e.g. the
// SDK's own tool_use start was missed across a watchdog/resume boundary.
// Falls back to a generic, still-nonempty title rather than dropping the
// status transition on the floor; mergeActivityRow on the projector side
// will keep this only if no better title ever arrives for the same
// activityId.
const FALLBACK_TOOL_TITLE = "Tool"

const publishToolCallStarted = Effect.fn("ClaudeAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = Option.getOrNull(toolCallPathHint(fact.kind, fact.rawInput))
	yield* Ref.update(runtime.openToolCalls, (current) =>
		HashMap.set(current, fact.toolCallId, { activityId, title: fact.title, path }))
	const event = yield* makeToolCallObserved(runtime, {
		activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: fact.title,
		path
	})
	return yield* offerOutbound(runtime, event)
})

// #268 defect 2: a real Claude permission prompt used to fold into the
// generic makeMetaEvent/SessionMetaUpdated branch below, whose metadata
// nobody reads for approvals (ProjectionPendingApprovals.apply only reacts
// to a native ApprovalRequested/InteractionReplied event or an explicitly
// stamped pendingApproval metadata key -- neither ever happened here), so
// projection_pending_approvals never learned about it and the desktop panel
// had nothing to render: the turn just hung on an approval no one could see
// or answer. Mirrors publishToolCallStarted's own carve-out from the
// generic branch -- a real, typed event instead of an opaque metadata blob.
const publishApprovalRequested = Effect.fn("ClaudeAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "permission_request" }>
) {
	const header = yield* stamp(runtime)
	const approvalRequestId = ApprovalRequestId.make(fact.id)
	const event = ApprovalRequestedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ApprovalRequested",
		payload: {
			sessionId: runtime.sessionId,
			approvalRequestId,
			title: fact.permission
		}
	})
	return yield* offerOutbound(runtime, event)
})

const publishToolCallUpdated = Effect.fn("ClaudeAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "tool_call_update" }>
) {
	if (fact.status === undefined) {
		// A pure streaming-argument update (input_json_delta) -- no status
		// transition to project, nothing worth a projection_session_activities
		// row for yet.
		return
	}
	const cache = yield* Ref.get(runtime.openToolCalls)
	const cached = HashMap.get(cache, fact.toolCallId)
	const info: OpenToolCallInfo = Option.getOrElse(cached, () => ({
		activityId: toolCallActivityId(fact.toolCallId),
		title: FALLBACK_TOOL_TITLE,
		path: null
	}))
	const event = yield* makeToolCallObserved(runtime, {
		activityId: info.activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: info.title,
		path: info.path
	})
	return yield* offerOutbound(runtime, event)
})

export const publishFact = Effect.fn("ClaudeAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: ClaudeContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	if (fact.contractKind === "turn_complete" || fact.contractKind === "turn_error") {
		// Closes the watchdog's window regardless of who ended the turn — the
		// SDK's own result message, or the watchdog itself synthesizing
		// turn_error for a stall it just recovered from.
		yield* Ref.set(runtime.turnOpenedAtMs, Option.none())
		const event = yield* makeCompleted(runtime)
		return yield* offerOutbound(runtime, event)
	}
	// A real Claude tool call must reach ProjectionSessionActivities as a
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one
	// (see makeToolCallObserved's doc) -- that was the live QA bug: a tool
	// call visibly executed but projection_session_activities stayed empty.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	// #268 defect 2: same carve-out as tool_call/tool_call_update above -- see
	// publishApprovalRequested's doc for why a permission request cannot stay
	// folded into the generic makeMetaEvent branch.
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

export const publishSdkMessage = Effect.fn("ClaudeAdapter.publishSdkMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const state = yield* Ref.get(runtime.streamState)
	const mapped = mapSdkMessage(state, raw)
	yield* Ref.set(runtime.streamState, mapped.state)
	yield* Effect.forEach(mapped.facts, (fact) => publishFact(runtime, fact), { discard: true })
})

export const requireSession = Effect.fn("ClaudeAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Claude session '${sessionId}'.`)
	}
	return found.value
})
