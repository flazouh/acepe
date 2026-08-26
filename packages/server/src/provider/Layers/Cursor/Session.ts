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
import { toolCallPathHint } from "./Tools.ts"

// What the "tool_call" fact recorded, kept so the LATER "tool_call_update"
// fact (which carries only a toolCallId and a status -- see ToolCallUpdateFact
// in Facts.ts) can still publish a complete ToolCallObservedEvent: the
// projector's ToolCallObservedPayload requires a title on every row, not just
// the first one.
export type OpenToolCallInfo = {
	readonly activityId: ActivityId
	readonly title: string
	readonly path: string | null
}

// One projection_session_activities row per ACP tool call, keyed the same way
// across its whole lifecycle (start -> completed/failed) so the projector's
// merge sees one growing row instead of two unrelated ones. The ACP toolCallId
// is already unique per call, so deriving the activityId from it is enough.
const toolCallActivityId = (toolCallId: string): ActivityId =>
	ActivityId.make(`${toolCallId}:activity`)

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<CursorPermissionDecision>>
	>
	// Keyed by the ACP toolCallId. See OpenToolCallInfo's doc above.
	readonly openToolCalls: Ref.Ref<HashMap.HashMap<string, OpenToolCallInfo>>
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

// Builds the SAME contract event the tracer's ToolCallObserveCommand decider
// produces (see decider.ts's "tool.call.observe" case): ProjectionSessionActivities
// only knows how to turn a ToolCallObserved event into a
// projection_session_activities row, so a real Cursor tool call folded into a
// generic SessionMetaUpdated is invisible to that projector no matter what
// its encoded metadata says.
const makeToolCallObserved = Effect.fn("CursorAdapter.makeToolCallObserved")(function*(
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

// A tool_call_update fact that arrives with no cached start info, e.g. the
// tool_call notification landed before this session's runtime was held.
// Falls back to a generic, still-nonempty title rather than dropping the
// status transition on the floor; mergeActivityRow keeps this only until a
// better title arrives for the same activityId.
const FALLBACK_TOOL_TITLE = "Tool"

const publishToolCallStarted = Effect.fn("CursorAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<CursorContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = Option.getOrNull(toolCallPathHint(fact.kind, fact.rawInput))
	yield* Ref.update(runtime.openToolCalls, (current) =>
		HashMap.set(current, fact.toolCallId, { activityId, title: fact.title, path })
	)
	const event = yield* makeToolCallObserved(runtime, {
		activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: fact.title,
		path
	})
	return yield* offerOutbound(runtime, event)
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
	// A real Cursor tool call must reach ProjectionSessionActivities as a
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one:
	// see makeToolCallObserved's doc.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
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
