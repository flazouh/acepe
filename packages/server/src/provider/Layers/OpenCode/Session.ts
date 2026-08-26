import {
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
	approvalRequestedEvent,
	type OpenToolCalls,
	rememberOpenToolCall,
	takeOpenToolCall,
	toolCallActivityId,
	toolCallObservedEvent
} from "../SessionEvents.ts"
import { encodeContractFact } from "./Codec.ts"
import type { OpenCodeContractFact } from "./Facts.ts"
import { mapSseJson, type OpenCodeStreamState, sseSessionId } from "./Map.ts"
import type { OpenCodeTransport } from "./Process.ts"
import { adapterError } from "./Provider.ts"

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly workspaceRoot: string
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly streamState: Ref.Ref<OpenCodeStreamState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	// Keyed by OpenCode's own toolCallId. See OpenToolCallInfo in SessionEvents.ts.
	readonly openToolCalls: OpenToolCalls
	readonly transport: OpenCodeTransport
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

const stamp = Effect.fn("OpenCodeAdapter.stamp")(function*(runtime: SessionRuntime) {
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

const makeTokenEvent = Effect.fn("OpenCodeAdapter.makeTokenEvent")(function*(
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

export const makeMetaEvent = Effect.fn("OpenCodeAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: OpenCodeContractFact
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

export const makeMessageSent = Effect.fn("OpenCodeAdapter.makeMessageSent")(function*(
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

export const makeCancelled = Effect.fn("OpenCodeAdapter.makeCancelled")(function*(runtime: SessionRuntime) {
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

// OpenCode's own turn-end signal is a session.idle (or idle-shaped
// session.status) SSE event — mapSseJson in Map.ts already turns it
// into a turn_complete or turn_error fact. That fact is the ONLY thing that
// closes an open projection_turns row absent a follow-up TurnCancelled or the
// next MessageSent starting a new turn — see ProjectionTurns.ts's
// evolveProjectedTurns. turn_error still closes the turn (rather than
// leaving it "running" forever): projection_turns has no separate "failed"
// status yet, so an errored turn is recorded as completed.
const makeCompleted = Effect.fn("OpenCodeAdapter.makeCompleted")(function*(
	runtime: SessionRuntime
) {
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

// Map.ts's tool parts don't carry a dedicated path field the way Claude's
// read/edit rawInput does, so every OpenCode activity row leaves the path
// column null rather than guessing at one of several possible input shapes.
const OPENCODE_TOOL_PATH = null

const publishToolCallStarted = Effect.fn("OpenCodeAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	yield* rememberOpenToolCall(runtime.openToolCalls, fact.toolCallId, fact.status, {
		activityId,
		title: fact.title,
		path: OPENCODE_TOOL_PATH
	})
	const header = yield* stamp(runtime)
	return yield* offerOutbound(
		runtime,
		toolCallObservedEvent(header, runtime.sessionId, {
			activityId,
			toolCallId: fact.toolCallId,
			status: fact.status,
			title: fact.title,
			path: OPENCODE_TOOL_PATH
		})
	)
})

const publishToolCallUpdated = Effect.fn("OpenCodeAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "tool_call_update" }>
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
			path: OPENCODE_TOOL_PATH
		})
	)
})

const publishApprovalRequested = Effect.fn("OpenCodeAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "permission_request" }>
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

// AC-269: mirrors Claude/Session.ts's publishTurnUsageObserved -- a real
// OpenCode usage reading must reach ProjectionTurns as a typed
// TurnUsageObserved event, not fold into a generic SessionMetaUpdated one
// (see TurnUsageObservedPayload's doc in acp.ts). turnId is derived the same
// way makeCompleted derives one here: the last user message this runtime has
// seen IS the current turn's id. Conditional spreads (not
// `field: fact.field`) keep an absent UsageFact field genuinely absent
// instead of present-with-undefined -- TurnUsageObservedEvent.make throws on
// the latter for a Schema.optionalKey field, which killed the Claude
// adapter's query-listener fiber mid Effect.forEach until that fix landed
// (see Claude/Session.ts's makeTurnUsageObserved doc). OpenCode's UsageFact
// carries no context-window reading, so that field is never set here.
const makeTurnUsageObserved = Effect.fn("OpenCodeAdapter.makeTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "usage" }>
) {
	const header = yield* stamp(runtime)
	const lastUser = yield* Ref.get(runtime.lastUserMessageId)
	const payload = {
		sessionId: runtime.sessionId,
		...(Option.isSome(lastUser) ? { turnId: TurnId.make(lastUser.value) } : {}),
		...(fact.inputTokens !== undefined ? { inputTokens: fact.inputTokens } : {}),
		...(fact.outputTokens !== undefined ? { outputTokens: fact.outputTokens } : {}),
		...(fact.totalTokens !== undefined ? { totalTokens: fact.totalTokens } : {}),
		...(fact.cacheReadTokens !== undefined ? { cacheReadTokens: fact.cacheReadTokens } : {}),
		...(fact.cacheWriteTokens !== undefined ? { cacheWriteTokens: fact.cacheWriteTokens } : {}),
		...(fact.costUsd !== undefined ? { costUsd: fact.costUsd } : {})
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

const publishTurnUsageObserved = Effect.fn("OpenCodeAdapter.publishTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "usage" }>
) {
	const event = yield* makeTurnUsageObserved(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const publishFact = Effect.fn("OpenCodeAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: OpenCodeContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	if (fact.contractKind === "turn_complete" || fact.contractKind === "turn_error") {
		const event = yield* makeCompleted(runtime)
		return yield* offerOutbound(runtime, event)
	}
	// A real OpenCode tool call must reach ProjectionSessionActivities as a
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one —
	// see toolCallObservedEvent's doc in SessionEvents.ts.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	// Same carve-out as tool_call above: an OpenCode permission.asked has to
	// reach ProjectionPendingApprovals as a typed ApprovalRequested event, or
	// the desktop never learns there is an approval to answer — see
	// approvalRequestedEvent's doc in SessionEvents.ts.
	if (fact.contractKind === "permission_request") {
		return yield* publishApprovalRequested(runtime, fact)
	}
	if (fact.contractKind === "usage") {
		return yield* publishTurnUsageObserved(runtime, fact)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const belongsToSession = (providerSessionId: Option.Option<string>, raw: Json): boolean => {
	if (Option.isNone(providerSessionId)) {
		return true
	}
	const eventSession = sseSessionId(raw)
	if (Option.isNone(eventSession)) {
		return true
	}
	return eventSession.value === providerSessionId.value
}

export const publishSse = Effect.fn("OpenCodeAdapter.publishSse")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const state = yield* Ref.get(runtime.streamState)
	if (belongsToSession(state.providerSessionId, raw) === false) {
		return
	}
	const mapped = mapSseJson(state, raw)
	yield* Ref.set(runtime.streamState, mapped.state)
	yield* Effect.forEach(mapped.facts, (fact) => publishFact(runtime, fact), { discard: true })
})

export const requireSession = Effect.fn("OpenCodeAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No OpenCode session '${sessionId}'.`)
	}
	return found.value
})

export const requireProviderSession = Effect.fn("OpenCodeAdapter.requireProviderSession")(function*(
	runtime: SessionRuntime,
	operation: ProviderAdapterError["operation"]
) {
	const state = yield* Ref.get(runtime.streamState)
	if (Option.isNone(state.providerSessionId)) {
		return yield* adapterError(
			operation,
			`OpenCode session '${runtime.sessionId}' has no provider session id.`
		)
	}
	return state.providerSessionId.value
})
