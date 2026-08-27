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
	TurnUsageObservedEvent,
	tracerAssistantMessageId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as DateTime from "effect/DateTime"
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
import type { CopilotContractFact } from "./Facts.ts"
import { mapAcpUpdate } from "./Map.ts"
import type { CopilotAcpHandle } from "./Process.ts"
import { adapterError } from "./Provider.ts"
import { toolCallPathHint } from "./Tools.ts"
import type { CopilotTurnState } from "./TurnTracking.ts"
import { jsonRpcParams, jsonRpcRequestId } from "./Wire.ts"

// What answering one agent-initiated session/request_permission needs: the
// raw JSON-RPC id the reply must repeat, and the request itself, because the
// answer is one of the optionIds the request offered — ACP has no generic
// "allow" token. Declared here, beside the runtime that holds it, the same
// way Codex/Session.ts declares its replyIds map.
export type PendingPermission = {
	readonly replyId: Json
	readonly request: Json
}

export type PendingPermissions = Ref.Ref<HashMap.HashMap<string, PendingPermission>>

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly providerSessionId: Ref.Ref<Option.Option<string>>
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly turnState: Ref.Ref<CopilotTurnState>
	// Keyed by Copilot's own ACP toolCallId. See OpenToolCallInfo in
	// SessionEvents.ts.
	readonly openToolCalls: OpenToolCalls
	// Keyed by the approval id the permission fact carries.
	readonly pendingPermissions: PendingPermissions
	readonly transport: CopilotAcpHandle
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

const stamp = Effect.fn("CopilotAdapter.stamp")(function*(runtime: SessionRuntime) {
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

const makeTokenEvent = Effect.fn("CopilotAdapter.makeTokenEvent")(function*(
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

export const makeMetaEvent = Effect.fn("CopilotAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: CopilotContractFact
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

export const makeMessageSent = Effect.fn("CopilotAdapter.makeMessageSent")(function*(
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

export const makeCancelled = Effect.fn("CopilotAdapter.makeCancelled")(function*(
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

const publishToolCallStarted = Effect.fn("CopilotAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<CopilotContractFact, { readonly contractKind: "tool_call" }>
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

const publishToolCallUpdated = Effect.fn("CopilotAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<CopilotContractFact, { readonly contractKind: "tool_call_update" }>
) {
	if (fact.status === undefined) {
		// An update with no status transition, so there is no new row state to
		// project yet. partialJson streams the tool's arguments, not its
		// result, and the row already names the call.
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

const publishApprovalRequested = Effect.fn("CopilotAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<CopilotContractFact, { readonly contractKind: "permission_request" }>
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

// The other half of publishApprovalRequested, used by Permissions.ts when an
// approval is answered or abandoned — see approvalAnsweredEvent's doc in
// SessionEvents.ts for why an answer a provider mints on its own is a
// SessionMetaUpdated and not an InteractionReplied.
export const publishApprovalAnswered = Effect.fn("CopilotAdapter.publishApprovalAnswered")(
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

// #282, mirroring Codex/Session.ts's makeTurnUsageObserved: a real Copilot
// usage reading must reach ProjectionTurns as a typed TurnUsageObserved
// event, not fold into a generic SessionMetaUpdated one. turnId comes from
// the turn state machine's activeTurnId, the same value a steer keeps stable
// across prompts (see TurnTracking.ts).
//
// #274: eventId is the fact's own deterministic dedup key, composed in Map.ts
// from the ACP session id and every figure the reading carries, so the
// desktop's lastTelemetryEventId check can drop a redelivered reading instead
// of counting its cost twice.
//
// Conditional spreads (not `field: fact.field`) keep an absent UsageFact
// field genuinely absent instead of present-with-undefined:
// TurnUsageObservedEvent.make throws on the latter for a Schema.optionalKey
// field, and the throw would kill the notification-listener fiber mid
// Effect.forEach. Copilot reports no cache token split, so cacheReadTokens
// and cacheWriteTokens stay unset.
const makeTurnUsageObserved = Effect.fn("CopilotAdapter.makeTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<CopilotContractFact, { readonly contractKind: "usage" }>
) {
	const header = yield* stamp(runtime)
	const turnState = yield* Ref.get(runtime.turnState)
	const payload = {
		sessionId: runtime.sessionId,
		...(Option.isSome(turnState.activeTurnId) ? { turnId: turnState.activeTurnId.value } : {}),
		...(fact.eventId !== undefined ? { eventId: fact.eventId } : {}),
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
		payload
	})
})

const publishTurnUsageObserved = Effect.fn("CopilotAdapter.publishTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<CopilotContractFact, { readonly contractKind: "usage" }>
) {
	const event = yield* makeTurnUsageObserved(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

export const publishFact = Effect.fn("CopilotAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CopilotContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	// The same carve-outs Codex, Cursor and OpenCode already have. A real tool
	// call has to reach ProjectionSessionActivities as a ToolCallObserved
	// event, a permission prompt has to reach ProjectionPendingApprovals as an
	// ApprovalRequested one, and a usage reading has to reach ProjectionTurns
	// as a TurnUsageObserved one. Folded into a generic SessionMetaUpdated all
	// three are invisible to their projector, whatever the encoded metadata
	// says — see the builders' docs in SessionEvents.ts.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
	}
	if (fact.contractKind === "usage") {
		return yield* publishTurnUsageObserved(runtime, fact)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

// Recorded before the fact reaches the outbound queue, so the reply id is
// already known by the time the desktop answers the permission it announces.
// A permission that arrived as a session/update notification rather than a
// JSON-RPC request carries no id and records nothing: nothing is waiting on a
// reply, and respondToPermission then fails loudly instead of answering into
// the void.
const rememberReplyIds = Effect.fn("CopilotAdapter.rememberReplyIds")(function*(
	runtime: SessionRuntime,
	raw: Json,
	facts: ReadonlyArray<CopilotContractFact>
) {
	const replyId = jsonRpcRequestId(raw)
	if (Option.isNone(replyId)) {
		return
	}
	// The params, not the envelope: the optionIds an answer picks from live
	// there, and Permissions.ts's selectPermissionOptionId reads them off the
	// value stored here.
	const request = Option.getOrElse(jsonRpcParams(raw), (): Json => raw)
	yield* Effect.forEach(
		facts,
		(fact) =>
			fact.contractKind === "permission_request"
				? Ref.update(runtime.pendingPermissions, (current) =>
						HashMap.set(current, fact.id, {
							replyId: replyId.value,
							request
						}))
				: Effect.void,
		{ discard: true }
	)
})

export const publishAcpMessage = Effect.fn("CopilotAdapter.publishAcpMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const facts = mapAcpUpdate(raw)
	yield* rememberReplyIds(runtime, raw, facts)
	yield* Effect.forEach(facts, (fact) => publishFact(runtime, fact), { discard: true })
})

export const requireSession = Effect.fn("CopilotAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Copilot session '${sessionId}'.`)
	}
	return found.value
})

export const requireProviderSessionId = Effect.fn("CopilotAdapter.requireProviderSessionId")(
	function*(runtime: SessionRuntime, operation: ProviderAdapterError["operation"]) {
		const providerSessionId = yield* Ref.get(runtime.providerSessionId)
		if (Option.isNone(providerSessionId)) {
			return yield* adapterError(operation, "Copilot ACP session id is missing.")
		}
		return providerSessionId.value
	}
)
