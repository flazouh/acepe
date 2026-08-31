import {
	type ApprovalDecision,
	CommandId,
	EventId,
	MessageId,
	MessageSentEvent,
	type OrchestrationEvent,
	SessionId,
	type SessionModelCatalog,
	SessionMetaUpdatedEvent,
	sessionModelsListedFact,
	ThoughtAppendedEvent,
	TokenAppendedEvent,
	TurnCancelledEvent,
	TurnCompletedEvent,
	tracerAssistantMessageId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as DateTime from "effect/DateTime"
import type * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import type {
	ProviderAdapterError,
	SendPromptRequest
} from "../../Services/ProviderAdapter.ts"
import { EMPTY_JSON_OBJECT, type Json } from "../Json.ts"
import { encodeSessionModelsFact } from "../SessionModelsFact.ts"
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
import { type GrokContractFact, turnCompleteFact } from "./Facts.ts"
import { mapAcpSessionNotification } from "./Map.ts"
import type { GrokAcpHandle, GrokStopReason } from "./Process.ts"
import { adapterError, type GrokPermissionDecision } from "./Provider.ts"
import { toolCallPathHint } from "./Tools.ts"

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<GrokPermissionDecision>>
	>
	// Keyed by the ACP toolCallId. See OpenToolCallInfo in SessionEvents.ts.
	readonly openToolCalls: OpenToolCalls
	readonly providerSessionId: Ref.Ref<Option.Option<string>>
	// Offers the ACP id once session/new returns. sendPrompt waits here
	// instead of failing while New-chat's first message.send races the
	// handshake. A Deferred.await deadlocks this Effect version.
	readonly acpSessionReady: Queue.Queue<string, Done>
	readonly handle: GrokAcpHandle
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

const stamp = Effect.fn("GrokAdapter.stamp")(function*(runtime: SessionRuntime) {
	const sequence = yield* nextSequence(runtime)
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const commandId = CommandId.make(`${runtime.sessionId}:cmd:${sequence}`)
	return {
		sequence,
		eventId: EventId.make(`${runtime.sessionId}:${sequence}`),
		occurredAt,
		commandId
	}
})

export const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
	Queue.offer(runtime.outbound, event).pipe(Effect.asVoid)

const makeTokenEvent = Effect.fn("GrokAdapter.makeTokenEvent")(function*(
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

const makeThoughtEvent = Effect.fn("GrokAdapter.makeThoughtEvent")(function*(
	runtime: SessionRuntime,
	token: string
) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	return ThoughtAppendedEvent.make({
		sequence: header.sequence,
		eventId: header.eventId,
		aggregateKind: "session",
		aggregateId: runtime.sessionId,
		occurredAt: header.occurredAt,
		commandId: header.commandId,
		causationEventId: null,
		correlationId: header.commandId,
		metadata: EMPTY_JSON_OBJECT,
		type: "ThoughtAppended",
		payload: {
			sessionId: runtime.sessionId,
			messageId: assistantMessageId(runtime.sessionId, lastUser),
			token
		}
	})
})

const makeMetaEvent = Effect.fn("GrokAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: GrokContractFact
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

/**
 * The catalog the provider itself reported, as a canonical session fact.
 *
 * Same SessionMetaUpdated envelope every other provider fact uses, through
 * the shared codec rather than Grok's own fact union — see
 * Layers/SessionModelsFact.ts.
 */
export const makeSessionModelsEvent = Effect.fn("GrokAdapter.makeSessionModelsEvent")(
	function*(runtime: SessionRuntime, models: SessionModelCatalog) {
		const header = yield* stamp(runtime)
		const metadata = Option.getOrElse(
			encodeSessionModelsFact(sessionModelsListedFact(models)),
			() => EMPTY_JSON_OBJECT
		)
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
	}
)

export const makeMessageSent = Effect.fn("GrokAdapter.makeMessageSent")(function*(
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

export const makeCancelled = Effect.fn("GrokAdapter.makeCancelled")(function*(
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

// grok's own turn-end signal is the stop reason session/prompt
// answers with (publishStopReason below turns it into a turn_complete or a
// turn_error fact). That fact is the ONLY thing that closes an open
// projection_turns row absent a follow-up TurnCancelled or the next
// MessageSent starting a new turn — see ProjectionTurns.ts's
// evolveProjectedTurns, whose SessionMetaUpdated branch is a no-op. A
// turn_error still closes the turn rather than leaving it "running" forever:
// projection_turns has no separate "failed" status yet, so an errored turn is
// recorded as completed, the same call Codex and OpenCode already make.
//
// The payload names no turn: a Grok session runs one turn at a time and
// the adapter tracks no turn id of its own, so projectTurnCompleted's
// fallback closes whichever turn is open.
const makeCompleted = Effect.fn("GrokAdapter.makeCompleted")(function*(
	runtime: SessionRuntime
) {
	const header = yield* stamp(runtime)
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
		payload: {
			sessionId: runtime.sessionId
		}
	})
})

const publishToolCallStarted = Effect.fn("GrokAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<GrokContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = Option.getOrNull(toolCallPathHint(fact.kind, fact.rawInput))
	yield* rememberOpenToolCall(runtime.openToolCalls, fact.toolCallId, fact.status, {
		activityId,
		title: fact.title,
		path,
		kind: fact.kind,
		// This provider does not read a tool call's arguments off its own fact
		// yet (Claude is the only one widened so far), so there is nothing to
		// cache here and nothing to repeat on the settling event.
		toolInput: null
	})
	const header = yield* stamp(runtime)
	return yield* offerOutbound(
		runtime,
		toolCallObservedEvent(header, runtime.sessionId, {
			activityId,
			toolCallId: fact.toolCallId,
			status: fact.status,
			title: fact.title,
			path,
			// An ACP tool_call that is only starting has produced no result.
			output: null,
			kind: fact.kind
		})
	)
})

const publishToolCallUpdated = Effect.fn("GrokAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<GrokContractFact, { readonly contractKind: "tool_call_update" }>
) {
	if (fact.status === undefined) {
		// An update with no status transition, so there is no new row state to
		// project yet.
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
			path: info.path,
			kind: info.kind,
			output: fact.output ?? null
		})
	)
})

const publishApprovalRequested = Effect.fn("GrokAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<GrokContractFact, { readonly contractKind: "permission_request" }>
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
// same per-session sequence and the same id scheme as a stamped one and can
// never collide with it.
export const publishApprovalAnswered = Effect.fn("GrokAdapter.publishApprovalAnswered")(
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

export const publishFact = Effect.fn("GrokAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: GrokContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	// Same carve-out as text_delta: thought content is transcript product
	// truth and must not fold into generic SessionMetaUpdated metadata --
	// see makeThoughtEvent's doc in Claude/Session.ts.
	if (fact.contractKind === "thought_delta") {
		const event = yield* makeThoughtEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	// A real Grok tool call must reach ProjectionSessionActivities as a
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one:
	// see toolCallObservedEvent's doc in SessionEvents.ts. An ACP permission
	// request needs the same carve-out for ProjectionPendingApprovals: see
	// approvalRequestedEvent's doc there.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
	}
	if (fact.contractKind === "turn_complete" || fact.contractKind === "turn_error") {
		const event = yield* makeCompleted(runtime)
		return yield* offerOutbound(runtime, event)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

export const publishStopReason = Effect.fn("GrokAdapter.publishStopReason")(function*(
	runtime: SessionRuntime,
	reason: GrokStopReason
) {
	if (reason === "end_turn") {
		return yield* publishFact(runtime, turnCompleteFact)
	}
	if (reason === "cancelled") {
		return
	}
	return yield* publishFact(runtime, {
		contractKind: "turn_error",
		detail: reason
	})
})

export const publishSessionUpdate = Effect.fn("GrokAdapter.publishSessionUpdate")(function*(
	runtimeHolder: Ref.Ref<Option.Option<SessionRuntime>>,
	notification: Json
) {
	const held = yield* Ref.get(runtimeHolder)
	if (Option.isNone(held)) {
		return
	}
	const fact = mapAcpSessionNotification(notification)
	if (Option.isNone(fact)) {
		return
	}
	yield* publishFact(held.value, fact.value)
})

export const requireSession = Effect.fn("GrokAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Grok session '${sessionId}'.`)
	}
	return found.value
})

export const requireProviderSessionId = Effect.fn("GrokAdapter.requireProviderSessionId")(
	function*(runtime: SessionRuntime, operation: ProviderAdapterError["operation"]) {
		const already = yield* Ref.get(runtime.providerSessionId)
		if (Option.isSome(already)) {
			return already.value
		}
		return yield* Queue.take(runtime.acpSessionReady).pipe(
			Effect.catch(() => adapterError(operation, "Grok ACP session id is missing."))
		)
	}
)
