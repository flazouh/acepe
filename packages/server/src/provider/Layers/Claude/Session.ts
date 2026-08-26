import {
	type ApprovalDecision,
	CommandId,
	EventId,
	MessageId,
	MessageSentEvent,
	type OrchestrationEvent,
	SessionId,
	SessionMetaUpdatedEvent,
	TokenAppendedEvent,
	TurnCancelledEvent,
	TurnCompletedEvent,
	TurnId,
	TurnUsageObservedEvent,
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
import * as Scope from "effect/Scope"
import type { ProviderAdapterError, SendPromptRequest } from "../../Services/ProviderAdapter.ts"
import { EMPTY_JSON_OBJECT, type Json } from "../Json.ts"
import {
	approvalAnsweredEvent,
	approvalRequestedEvent,
	type OpenToolCalls,
	rememberOpenToolCall,
	takeOpenToolCall,
	toolCallActivityId,
	toolCallObservedEvent
} from "../SessionEvents.ts"
import { encodeContractFact } from "./Codec.ts"
import type { ClaudeContractFact, ClaudePermissionDecision } from "./Facts.ts"
import { mapSdkMessage, type ClaudeStreamState } from "./Map.ts"
import type { ClaudeQueryHandle } from "./Process.ts"
import { adapterError } from "./Provider.ts"
import { toolCallPathHint } from "./Tools.ts"
import type { ClaudeUserPrompt } from "./Wire.ts"

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
	// Keyed by the SDK's own toolCallId. See OpenToolCallInfo in SessionEvents.ts.
	readonly openToolCalls: OpenToolCalls
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
// Map.ts's mapSdkMessage already turns into a turn_complete (or
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

const publishToolCallStarted = Effect.fn("ClaudeAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = Option.getOrNull(toolCallPathHint(fact.kind, fact.rawInput))
	yield* rememberOpenToolCall(runtime.openToolCalls, fact.toolCallId, fact.status, {
		activityId,
		title: fact.title,
		path
	})
	const header = yield* stamp(runtime)
	return yield* offerOutbound(
		runtime,
		toolCallObservedEvent(header, runtime.sessionId, {
			activityId,
			toolCallId: fact.toolCallId,
			status: fact.status,
			title: fact.title,
			path
		})
	)
})

const publishApprovalRequested = Effect.fn("ClaudeAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "permission_request" }>
) {
	const header = yield* stamp(runtime)
	return yield* offerOutbound(
		runtime,
		approvalRequestedEvent(header, runtime.sessionId, {
			approvalRequestId: fact.id,
			title: fact.permission
		})
	)
})

// The other half of publishApprovalRequested, used by Permissions.ts's drain
// of abandoned permissions — see approvalAnsweredEvent's doc in
// SessionEvents.ts for why an answer a provider mints on its own is a
// SessionMetaUpdated and not an InteractionReplied. It goes through `stamp`
// like every other publisher here, so a drained approval's event carries the
// same per-session sequence and the same sessionId:openEpochMs:sequence id
// scheme (see that stamp's own doc for why the epoch is in there) and can
// never collide with a stamped one.
export const publishApprovalAnswered = Effect.fn("ClaudeAdapter.publishApprovalAnswered")(
	function*(runtime: SessionRuntime, approvalRequestId: string, decision: ApprovalDecision) {
		const header = yield* stamp(runtime)
		return yield* offerOutbound(
			runtime,
			approvalAnsweredEvent(header, runtime.sessionId, {
				approvalRequestId,
				decision
			})
		)
	}
)

// AC-269: same carve-out as toolCallObservedEvent/approvalRequestedEvent --
// a real Claude usage_update message must reach ProjectionTurns as a typed
// TurnUsageObserved event, not fold into a generic SessionMetaUpdated one
// (see TurnUsageObservedPayload's doc in acp.ts). turnId is derived the same
// way makeCompleted derives one: the last user message this runtime has seen
// IS the current turn's id (mirrors MessageSentPayload.messageId ->
// TurnId.make in ProjectionTurns.ts's projectMessageSent). Absent one (a
// usage reading that arrives before any prompt was ever sent on this
// runtime), the event still carries the reading with no turn id --
// ProjectionTurns falls back to whichever turn is currently open for the
// session, exactly like TurnCompleted/TurnCancelled already do.
const makeTurnUsageObserved = Effect.fn("ClaudeAdapter.makeTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "usage" }>
) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	const turnId = Option.map(lastUser, TurnId.make)
	// Schema.optionalKey requires the key to be ABSENT, not present with an
	// explicit `undefined` value -- a plain `inputTokens: fact.inputTokens`
	// spread would set the latter for any field UsageFact didn't carry (e.g.
	// the SDK result message's usage has no cost/context-window reading),
	// which made TurnUsageObservedEvent.make throw synchronously and killed
	// the query-listener fiber mid Effect.forEach, silently starving every
	// later event on the stream (including TurnCompleted) -- reproduced by
	// Adapter.test.ts's "emits TurnCompleted when the SDK stream delivers a
	// result message" hanging once usage stopped being swallowed into
	// SessionMetaUpdated. Conditional spreads keep an absent field absent.
	const basePayload = {
		sessionId: runtime.sessionId,
		...(fact.inputTokens !== undefined ? { inputTokens: fact.inputTokens } : {}),
		...(fact.outputTokens !== undefined ? { outputTokens: fact.outputTokens } : {}),
		...(fact.totalTokens !== undefined ? { totalTokens: fact.totalTokens } : {}),
		...(fact.costUsd !== undefined ? { costUsd: fact.costUsd } : {}),
		...(fact.contextWindowSize !== undefined ? { contextWindowSize: fact.contextWindowSize } : {})
	}
	return TurnUsageObservedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "TurnUsageObserved",
		payload: Option.match(turnId, {
			onNone: () => basePayload,
			onSome: (id) => ({ ...basePayload, turnId: id })
		})
	})
})

const publishTurnUsageObserved = Effect.fn("ClaudeAdapter.publishTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<ClaudeContractFact, { readonly contractKind: "usage" }>
) {
	const event = yield* makeTurnUsageObserved(runtime, fact)
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
	const info = yield* takeOpenToolCall(runtime.openToolCalls, fact.toolCallId, fact.status)
	const header = yield* stamp(runtime)
	return yield* offerOutbound(
		runtime,
		toolCallObservedEvent(header, runtime.sessionId, {
			activityId: info.activityId,
			toolCallId: fact.toolCallId,
			status: fact.status,
			title: info.title,
			path: info.path
		})
	)
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
	// (see toolCallObservedEvent's doc in SessionEvents.ts) -- that was the
	// live QA bug: a tool call visibly executed but
	// projection_session_activities stayed empty.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	// #268 defect 2: same carve-out as tool_call/tool_call_update above -- see
	// approvalRequestedEvent's doc in SessionEvents.ts for why a permission
	// request cannot stay folded into the generic makeMetaEvent branch.
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
	}
	// AC-269: same carve-out as tool_call/permission_request above -- see
	// publishTurnUsageObserved's doc for why a usage reading cannot stay
	// folded into the generic makeMetaEvent branch.
	if (fact.contractKind === "usage") {
		return yield* publishTurnUsageObserved(runtime, fact)
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
