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
import { type CursorContractFact, turnCompleteFact } from "./Facts.ts"
import { mapAcpSessionNotification } from "./Map.ts"
import type { CursorAcpHandle, CursorStopReason } from "./Process.ts"
import { adapterError, type CursorPermissionDecision } from "./Provider.ts"
import { toolCallPathHint } from "./Tools.ts"

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<CursorPermissionDecision>>
	>
	// Keyed by the ACP toolCallId. See OpenToolCallInfo in SessionEvents.ts.
	readonly openToolCalls: OpenToolCalls
	readonly providerSessionId: Ref.Ref<Option.Option<string>>
	readonly handle: CursorAcpHandle
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

const stamp = Effect.fn("CursorAdapter.stamp")(function*(runtime: SessionRuntime) {
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

const makeTokenEvent = Effect.fn("CursorAdapter.makeTokenEvent")(function*(
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

const makeMetaEvent = Effect.fn("CursorAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: CursorContractFact
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

export const makeMessageSent = Effect.fn("CursorAdapter.makeMessageSent")(function*(
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

export const makeCancelled = Effect.fn("CursorAdapter.makeCancelled")(function*(
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

// cursor-agent's own turn-end signal is the stop reason session/prompt
// answers with (publishStopReason below turns it into a turn_complete or a
// turn_error fact). That fact is the ONLY thing that closes an open
// projection_turns row absent a follow-up TurnCancelled or the next
// MessageSent starting a new turn — see ProjectionTurns.ts's
// evolveProjectedTurns, whose SessionMetaUpdated branch is a no-op. A
// turn_error still closes the turn rather than leaving it "running" forever:
// projection_turns has no separate "failed" status yet, so an errored turn is
// recorded as completed, the same call Codex and OpenCode already make.
//
// The payload names no turn: a Cursor session runs one turn at a time and
// the adapter tracks no turn id of its own, so projectTurnCompleted's
// fallback closes whichever turn is open.
const makeCompleted = Effect.fn("CursorAdapter.makeCompleted")(function*(
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

const publishToolCallStarted = Effect.fn("CursorAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<CursorContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = Option.getOrNull(toolCallPathHint(fact.kind, fact.rawInput))
	yield* rememberOpenToolCall(runtime.openToolCalls, fact.toolCallId, fact.status, {
		activityId,
		title: fact.title,
		path,
		kind: fact.kind
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

const publishToolCallUpdated = Effect.fn("CursorAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<CursorContractFact, { readonly contractKind: "tool_call_update" }>
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

const publishApprovalRequested = Effect.fn("CursorAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<CursorContractFact, { readonly contractKind: "permission_request" }>
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
export const publishApprovalAnswered = Effect.fn("CursorAdapter.publishApprovalAnswered")(
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

export const publishFact = Effect.fn("CursorAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CursorContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	// A real Cursor tool call must reach ProjectionSessionActivities as a
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

export const publishStopReason = Effect.fn("CursorAdapter.publishStopReason")(function*(
	runtime: SessionRuntime,
	reason: CursorStopReason
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

export const publishSessionUpdate = Effect.fn("CursorAdapter.publishSessionUpdate")(function*(
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

export const requireSession = Effect.fn("CursorAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Cursor session '${sessionId}'.`)
	}
	return found.value
})

export const requireProviderSessionId = Effect.fn("CursorAdapter.requireProviderSessionId")(
	function*(runtime: SessionRuntime, operation: ProviderAdapterError["operation"]) {
		const providerSessionId = yield* Ref.get(runtime.providerSessionId)
		if (Option.isNone(providerSessionId)) {
			return yield* adapterError(operation, "Cursor ACP session id is missing.")
		}
		return providerSessionId.value
	}
)
