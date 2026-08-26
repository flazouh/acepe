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
import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Str from "effect/String"
import type {
	ProviderAdapterError,
	SendPromptRequest
} from "../../Services/ProviderAdapter.ts"
import { EMPTY_JSON_OBJECT, type Json, type JsonObject } from "../Json.ts"
import { encodeContractFact } from "./Codec.ts"
import type { CodexAcpToolKind, CodexContractFact } from "./Facts.ts"
import { type CodexMapState, mapCodexServerMessage } from "./Map.ts"
import type { CodexAppServerHandle } from "./Process.ts"
import { adapterError, type CodexNativeConfigState } from "./Provider.ts"
import { jsonRpcRequestId } from "./Wire.ts"

// What a "tool_call" fact recorded about a tool call, kept around so a LATER
// "tool_call_update" fact (which may omit its own title — see
// ToolCallUpdateFact in Facts.ts) can still publish a complete
// ToolCallObservedEvent: the projector's ToolCallObservedPayload requires a
// title on every row, not just the first one — see
// ProjectionSessionActivities.ts's observedToolRow.
export type OpenToolCallInfo = {
	readonly activityId: ActivityId
	readonly title: string
	readonly path: string | null
}

// One projection_session_activities row per Codex tool item, keyed the same
// way across its whole lifecycle (in_progress -> completed/failed) so the
// projector's merge sees one growing row instead of two unrelated ones.
const toolCallActivityId = (toolCallId: string): ActivityId => ActivityId.make(`${toolCallId}:activity`)

// Tools.ts's extractToolFields already puts the file path into
// rawInput under "filePath" for read/edit items (see its fileRead/fileChange
// branches) — reused here, not reimplemented, to derive the path column of
// projection_session_activities.
const codexToolPathHint = (kind: CodexAcpToolKind, rawInput: JsonObject): string | null => {
	if (kind !== "read" && kind !== "edit") {
		return null
	}
	const value = rawInput.filePath
	if (Predicate.isString(value) && Str.isNonEmpty(Str.trim(value))) {
		return value
	}
	return null
}

export type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly mapState: Ref.Ref<CodexMapState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly providerThreadId: Ref.Ref<Option.Option<string>>
	readonly currentTurnId: Ref.Ref<Option.Option<string>>
	readonly questionIds: Ref.Ref<HashMap.HashMap<string, ReadonlyArray<string>>>
	// The raw JSON-RPC id of every request Codex is still waiting on a reply
	// for, keyed by the stringified id the contract facts carry. See
	// jsonRpcRequestId in Wire.ts: a reply has to repeat the id in its original
	// JSON type, and the fact only keeps the text form.
	readonly replyIds: Ref.Ref<HashMap.HashMap<string, Json>>
	// Keyed by Codex's own toolCallId. See OpenToolCallInfo's doc above.
	readonly openToolCalls: Ref.Ref<HashMap.HashMap<string, OpenToolCallInfo>>
	readonly modeId: Ref.Ref<string>
	readonly config: CodexNativeConfigState
	readonly server: CodexAppServerHandle
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

const stamp = Effect.fn("CodexAdapter.stamp")(function*(runtime: SessionRuntime) {
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

const makeTokenEvent = Effect.fn("CodexAdapter.makeTokenEvent")(function*(
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

export const makeMetaEvent = Effect.fn("CodexAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: CodexContractFact
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

export const makeMessageSent = Effect.fn("CodexAdapter.makeMessageSent")(function*(
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

export const makeCancelled = Effect.fn("CodexAdapter.makeCancelled")(function*(
	runtime: SessionRuntime,
	turnId: Option.Option<string>
) {
	const header = yield* stamp(runtime)
	const payload =
		Option.isNone(turnId)
			? {
					sessionId: runtime.sessionId
				}
			: {
					sessionId: runtime.sessionId,
					turnId: TurnId.make(turnId.value)
				}
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
		payload
	})
})

// Codex's own turn-end signal is the app-server's `turn/completed`
// notification (mapCodexServerMessage in Map.ts already turns it
// into a turn_complete or turn_error fact). That fact is the ONLY thing that
// closes an open projection_turns row absent a follow-up TurnCancelled or the
// next MessageSent starting a new turn — see ProjectionTurns.ts's
// evolveProjectedTurns. turn_error still closes the turn (rather than
// leaving it "running" forever): projection_turns has no separate "failed"
// status yet, so an errored turn is recorded as completed.
const makeCompleted = Effect.fn("CodexAdapter.makeCompleted")(function*(
	runtime: SessionRuntime,
	turnId: Option.Option<string>
) {
	const header = yield* stamp(runtime)
	const payload =
		Option.isNone(turnId)
			? {
					sessionId: runtime.sessionId
				}
			: {
					sessionId: runtime.sessionId,
					turnId: TurnId.make(turnId.value)
				}
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
		payload
	})
})

const rememberQuestionIds = Effect.fn("CodexAdapter.rememberQuestionIds")(function*(
	runtime: SessionRuntime,
	fact: CodexContractFact
) {
	if (fact.contractKind !== "question_request") {
		return
	}
	const ids = Arr.map(fact.questions, (question) => question.id)
	yield* Ref.update(runtime.questionIds, (current) => HashMap.set(current, fact.id, ids))
})

// Builds the SAME contract event the tracer's ToolCallObserveCommand decider
// produces (see decider.ts's "tool.call.observe" case) — ProjectionSessionActivities.ts
// only knows how to turn a ToolCallObserved event into a
// projection_session_activities row; a real Codex tool call folded into a
// generic SessionMetaUpdated is invisible to that projector no matter what
// its encoded metadata says (the same bug Claude/Adapter.ts had).
const makeToolCallObserved = Effect.fn("CodexAdapter.makeToolCallObserved")(function*(
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

// A tool_call_update fact that arrives with no cached start info. Falls back
// to a generic, still-nonempty title rather than dropping the status
// transition on the floor.
const FALLBACK_TOOL_TITLE = "Tool"

const publishToolCallStarted = Effect.fn("CodexAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = codexToolPathHint(fact.kind, fact.rawInput)
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

const publishToolCallUpdated = Effect.fn("CodexAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "tool_call_update" }>
) {
	const cache = yield* Ref.get(runtime.openToolCalls)
	const cached = HashMap.get(cache, fact.toolCallId)
	const info: OpenToolCallInfo = Option.getOrElse(cached, () => ({
		activityId: toolCallActivityId(fact.toolCallId),
		title: FALLBACK_TOOL_TITLE,
		path: null
	}))
	const title = fact.title ?? info.title
	const event = yield* makeToolCallObserved(runtime, {
		activityId: info.activityId,
		toolCallId: fact.toolCallId,
		status: fact.status,
		title,
		path: info.path
	})
	return yield* offerOutbound(runtime, event)
})

const publishFact = Effect.fn("CodexAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CodexContractFact
) {
	yield* rememberQuestionIds(runtime, fact)
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	if (fact.contractKind === "turn_complete" || fact.contractKind === "turn_error") {
		const currentTurnId = yield* Ref.get(runtime.currentTurnId)
		const turnId = fact.turnId !== undefined ? Option.some(fact.turnId) : currentTurnId
		yield* Ref.set(runtime.currentTurnId, Option.none())
		const event = yield* makeCompleted(runtime, turnId)
		return yield* offerOutbound(runtime, event)
	}
	// A real Codex tool call must reach ProjectionSessionActivities as a
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

// Recorded before the fact reaches the outbound queue, so the reply id is
// already known by the time the desktop answers the request it announces.
const rememberReplyId = Effect.fn("CodexAdapter.rememberReplyId")(function*(
	runtime: SessionRuntime,
	raw: Json,
	facts: ReadonlyArray<CodexContractFact>
) {
	const rawId = jsonRpcRequestId(raw)
	if (Option.isNone(rawId)) {
		return
	}
	yield* Effect.forEach(
		facts,
		(fact) =>
			fact.contractKind === "permission_request" || fact.contractKind === "question_request"
				? Ref.update(runtime.replyIds, (current) =>
						HashMap.set(current, fact.id, rawId.value))
				: Effect.void,
		{ discard: true }
	)
})

export const takeReplyId = Effect.fn("CodexAdapter.takeReplyId")(function*(
	runtime: SessionRuntime,
	id: string
) {
	const known = yield* Ref.get(runtime.replyIds)
	yield* Ref.update(runtime.replyIds, (current) => HashMap.remove(current, id))
	return Option.getOrElse(HashMap.get(known, id), (): Json => id)
})

export const publishServerMessage = Effect.fn("CodexAdapter.publishServerMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const state = yield* Ref.get(runtime.mapState)
	const mapped = mapCodexServerMessage(state, runtime.sessionId, raw)
	yield* Ref.set(runtime.mapState, mapped.state)
	yield* rememberReplyId(runtime, raw, mapped.facts)
	yield* Effect.forEach(mapped.facts, (fact) => publishFact(runtime, fact), { discard: true })
})

export const requireSession = Effect.fn("CodexAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Codex session '${sessionId}'.`)
	}
	return found.value
})
