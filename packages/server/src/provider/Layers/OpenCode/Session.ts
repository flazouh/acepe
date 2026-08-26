import {
	ActivityId,
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
import type { OpenCodeContractFact } from "./Facts.ts"
import { mapSseJson, type OpenCodeStreamState, sseSessionId } from "./Map.ts"
import type { OpenCodeTransport } from "./Process.ts"
import { adapterError } from "./Provider.ts"

// What a "tool_call" fact recorded about a tool call, kept around so a LATER
// "tool_call_update" fact (toolCallId + a new status only — see
// ToolCallUpdateFact in Facts.ts) can still publish a complete
// ToolCallObservedEvent: the projector's ToolCallObservedPayload requires a
// title on every row, not just the first one — see
// ProjectionSessionActivities.ts's observedToolRow.
export type OpenToolCallInfo = {
	readonly activityId: ActivityId
	readonly title: string
}

// One projection_session_activities row per OpenCode tool part, keyed the
// same way across its whole lifecycle (pending/in_progress -> completed/
// failed) so the projector's merge sees one growing row instead of two
// unrelated ones.
const toolCallActivityId = (toolCallId: string): ActivityId => ActivityId.make(`${toolCallId}:activity`)

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly workspaceRoot: string
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly streamState: Ref.Ref<OpenCodeStreamState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	// Keyed by OpenCode's own toolCallId. See OpenToolCallInfo's doc above.
	readonly openToolCalls: Ref.Ref<HashMap.HashMap<string, OpenToolCallInfo>>
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

// Builds the SAME contract event the tracer's ToolCallObserveCommand decider
// produces (see decider.ts's "tool.call.observe" case) — ProjectionSessionActivities.ts
// only knows how to turn a ToolCallObserved event into a
// projection_session_activities row; a real OpenCode tool call folded into a
// generic SessionMetaUpdated is invisible to that projector no matter what
// its encoded metadata says (the same bug Claude/Adapter.ts had).
const makeToolCallObserved = Effect.fn("OpenCodeAdapter.makeToolCallObserved")(function*(
	runtime: SessionRuntime,
	input: {
		readonly activityId: ActivityId
		readonly toolCallId: string
		readonly status: ObservedToolStatus
		readonly title: string
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
			// Map.ts's tool parts don't carry a dedicated path field the
			// way Claude's read/edit rawInput does — left null rather than
			// guessing at one of several possible input shapes.
			path: null
		}
	})
})

// A tool_call_update fact that arrives with no cached start info (e.g. a
// tool-result part with no preceding tool part in this stream). Falls back
// to a generic, still-nonempty title rather than dropping the status
// transition on the floor.
const FALLBACK_TOOL_TITLE = "Tool"

const publishToolCallStarted = Effect.fn("OpenCodeAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	yield* Ref.update(runtime.openToolCalls, (current) =>
		HashMap.set(current, fact.toolCallId, { activityId, title: fact.title }))
	const event = yield* makeToolCallObserved(runtime, {
		activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: fact.title
	})
	return yield* offerOutbound(runtime, event)
})

const publishToolCallUpdated = Effect.fn("OpenCodeAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<OpenCodeContractFact, { readonly contractKind: "tool_call_update" }>
) {
	if (fact.status === undefined) {
		// A pure streaming-argument update (partialJson) — no status
		// transition to project.
		return
	}
	const cache = yield* Ref.get(runtime.openToolCalls)
	const cached = HashMap.get(cache, fact.toolCallId)
	const info: OpenToolCallInfo = Option.getOrElse(cached, () => ({
		activityId: toolCallActivityId(fact.toolCallId),
		title: FALLBACK_TOOL_TITLE
	}))
	const event = yield* makeToolCallObserved(runtime, {
		activityId: info.activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title: info.title
	})
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
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
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
