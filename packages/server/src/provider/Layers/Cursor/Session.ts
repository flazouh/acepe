import {
	ApprovalRequestedEvent,
	ApprovalRequestId,
	CommandId,
	EventId,
	MessageId,
	MessageSentEvent,
	type OrchestrationEvent,
	SessionId,
	SessionMetaUpdatedEvent,
	TokenAppendedEvent,
	TurnCancelledEvent,
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
import { encodeContractFact } from "./Codec.ts"
import { type CursorContractFact, turnCompleteFact } from "./Facts.ts"
import { mapAcpSessionNotification } from "./Map.ts"
import type { CursorAcpHandle, CursorStopReason } from "./Process.ts"
import { adapterError, type CursorPermissionDecision } from "./Provider.ts"

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<CursorPermissionDecision>>
	>
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

// An ACP permission request cannot ride the generic SessionMetaUpdated
// branch below: ProjectionPendingApprovals.apply only reacts to a native
// ApprovalRequested/InteractionReplied event or an explicitly stamped
// pendingApproval metadata key, so an encoded fact left the desktop with no
// approval row to render and no way to send the InteractionReplied that
// unblocks decidePermission's deferred. The turn then hung on an approval
// nobody could see. Same carve-out ClaudeAdapter took for #268 defect 2.
const publishApprovalRequested = Effect.fn("CursorAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<CursorContractFact, { readonly contractKind: "permission_request" }>
) {
	const header = yield* stamp(runtime)
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
			approvalRequestId: ApprovalRequestId.make(fact.id),
			title: fact.permission
		}
	})
	return yield* offerOutbound(runtime, event)
})

export const publishFact = Effect.fn("CursorAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CursorContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
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
