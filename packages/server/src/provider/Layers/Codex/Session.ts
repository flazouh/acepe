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
import { EMPTY_JSON_OBJECT, type Json, type JsonObject, jsonText } from "../Json.ts"
import {
	approvalRequestedEvent,
	type OpenToolCalls,
	rememberOpenToolCall,
	takeOpenToolCall,
	toolCallActivityId,
	toolCallObservedEvent
} from "../SessionEvents.ts"
import { encodeContractFact } from "./Codec.ts"
import type { CodexAcpToolKind, CodexContractFact } from "./Facts.ts"
import { type CodexMapState, mapCodexServerMessage } from "./Map.ts"
import type { CodexAppServerHandle } from "./Process.ts"
import { adapterError, type CodexNativeConfigState } from "./Provider.ts"
import { jsonRpcRequestId } from "./Wire.ts"

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
	// Keyed by Codex's own toolCallId. See OpenToolCallInfo in SessionEvents.ts.
	readonly openToolCalls: OpenToolCalls
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

const publishToolCallStarted = Effect.fn("CodexAdapter.publishToolCallStarted")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "tool_call" }>
) {
	const activityId = toolCallActivityId(fact.toolCallId)
	const path = codexToolPathHint(fact.kind, fact.rawInput)
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
			path,
			// An item that is only starting has produced no result yet: Map.ts
			// reads one off item/completed only, into ToolCallUpdateFact's
			// result — see publishToolCallUpdated below.
			output: null
		})
	)
})

const publishToolCallUpdated = Effect.fn("CodexAdapter.publishToolCallUpdated")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "tool_call_update" }>
) {
	const info = yield* takeOpenToolCall(runtime.openToolCalls, fact.toolCallId, fact.status)
	const header = yield* stamp(runtime)
	// Codex's own update carries a title of its own often enough to prefer it
	// over the cached one — the other providers' updates never do.
	return yield* offerOutbound(
		runtime,
		toolCallObservedEvent(header, runtime.sessionId, {
			activityId: info.activityId,
			toolCallId: fact.toolCallId,
			status: fact.status,
			title: fact.title ?? info.title,
			path: info.path,
			// #273: Map.ts's toolResult has read aggregatedOutput (else
			// exitCode) into this fact all along and it stopped here. Json,
			// not string, because Codex reports both a command's text and an
			// { exitCode } object through the same field.
			output: fact.result === undefined ? null : jsonText(fact.result)
		})
	)
})

const publishApprovalRequested = Effect.fn("CodexAdapter.publishApprovalRequested")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "permission_request" }>
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
// Codex usage reading must reach ProjectionTurns as a typed
// TurnUsageObserved event, not fold into a generic SessionMetaUpdated one
// (see TurnUsageObservedPayload's doc in acp.ts). turnId comes straight from
// runtime.currentTurnId, the same Ref makeCompleted/makeCancelled already
// read. Conditional spreads (not `field: fact.field`) keep an absent
// UsageFact field genuinely absent instead of present-with-undefined --
// TurnUsageObservedEvent.make throws on the latter for a
// Schema.optionalKey field, which killed the query-listener fiber mid
// Effect.forEach in the Claude adapter until this same fix landed there
// (see Claude/Session.ts's makeTurnUsageObserved doc). Codex's UsageFact
// carries no cost reading at all, and reasoningTokens has no home on the
// shared contract payload yet -- documented gaps, not wired.
const makeTurnUsageObserved = Effect.fn("CodexAdapter.makeTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "usage" }>
) {
	const header = yield* stamp(runtime)
	const currentTurnId = yield* Ref.get(runtime.currentTurnId)
	const payload = {
		sessionId: runtime.sessionId,
		...(Option.isSome(currentTurnId) ? { turnId: TurnId.make(currentTurnId.value) } : {}),
		...(fact.inputTokens !== undefined ? { inputTokens: fact.inputTokens } : {}),
		...(fact.outputTokens !== undefined ? { outputTokens: fact.outputTokens } : {}),
		...(fact.totalTokens !== undefined ? { totalTokens: fact.totalTokens } : {}),
		...(fact.cacheReadTokens !== undefined ? { cacheReadTokens: fact.cacheReadTokens } : {}),
		...(fact.cacheWriteTokens !== undefined ? { cacheWriteTokens: fact.cacheWriteTokens } : {}),
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

const publishTurnUsageObserved = Effect.fn("CodexAdapter.publishTurnUsageObserved")(function*(
	runtime: SessionRuntime,
	fact: Extract<CodexContractFact, { readonly contractKind: "usage" }>
) {
	const event = yield* makeTurnUsageObserved(runtime, fact)
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
	// ToolCallObserved event, not fold into a generic SessionMetaUpdated one —
	// see toolCallObservedEvent's doc in SessionEvents.ts.
	if (fact.contractKind === "tool_call") {
		return yield* publishToolCallStarted(runtime, fact)
	}
	if (fact.contractKind === "tool_call_update") {
		return yield* publishToolCallUpdated(runtime, fact)
	}
	// Same carve-out as tool_call above: a native requestApproval has to reach
	// ProjectionPendingApprovals as a typed ApprovalRequested event, or the
	// desktop never learns there is an approval to answer, even though
	// respondToPermission would work — see approvalRequestedEvent's doc in
	// SessionEvents.ts.
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

// Claims the raw JSON-RPC id of a request Codex is still waiting on, and
// gives it up: the read and the removal are ONE Ref.modify step, so two
// replies racing the same request cannot both come away with an id and
// answer it twice.
//
// None means there is nothing left to answer: a second reply, a question
// that arrived as a NOTIFICATION rather than a request (rememberReplyId
// records nothing then, while rememberQuestionIds still does — see Map.ts's
// fallback to the item id), or a retry after an earlier attempt already
// claimed it. Every caller MUST fail on None. Falling back to the fact's
// text id, as this used to, answers a numeric request with a string:
// Codex requires the response id to repeat the request id in its original
// JSON type, so that reply is dropped and the request hangs with no error
// anywhere — quieter than the loud failure it replaced, and worse.
export const takeReplyId = Effect.fn("CodexAdapter.takeReplyId")(function*(
	runtime: SessionRuntime,
	id: string
) {
	return yield* Ref.modify(runtime.replyIds, (current) =>
		[HashMap.get(current, id), HashMap.remove(current, id)] as const)
})

// Puts a claim back when the reply it was taken for never went out, so the
// entry only really disappears once server.reply succeeded — the same
// "remove after the reply lands" order respondToQuestion already keeps for
// questionIds. ProviderBridge retries respondToPermission after a lazy
// session open (see LAZY_OPEN_RETRY_SCHEDULE), and a claim burned by the
// failed attempt would leave the retry with nothing to answer with.
export const restoreReplyId = (runtime: SessionRuntime, id: string, replyId: Json) =>
	Ref.update(runtime.replyIds, (current) => HashMap.set(current, id, replyId))

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
