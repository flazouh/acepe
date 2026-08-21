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
	TurnId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import {
	ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type StartSessionRequest
} from "../Services/ProviderAdapter.ts"
import {
	type CopilotContractFact,
	encodeContractFact,
	mapAcpUpdate,
	mapPromptResult,
	providerSessionFact
} from "./CopilotAcpMap.ts"
import {
	COPILOT_CAPABILITIES,
	COPILOT_PROVIDER_ID,
	copilotSessionNewParams
} from "./CopilotProvider.ts"
import {
	beginCopilotPrompt,
	cancelCopilotTurn,
	completeCopilotPrompt,
	emptyCopilotTurnState,
	type CopilotTurnState
} from "./CopilotTurnTracking.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const EMPTY_JSON_OBJECT: JsonObject = {}

export type CopilotAcpRequest = {
	readonly method: string
	readonly params: Json
}

export type CopilotAcpHandle = {
	readonly notifications: Stream.Stream<Json, ProviderAdapterError>
	readonly request: (
		method: string,
		params: Json
	) => Effect.Effect<Json, ProviderAdapterError>
	readonly notify: (method: string, params: Json) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export type CopilotAdapterOptions = {
	readonly createTransport: (
		input: { readonly cwd: string }
	) => Effect.Effect<CopilotAcpHandle, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
}

type SessionRuntime = {
	readonly sessionId: SessionId
	readonly providerSessionId: Ref.Ref<Option.Option<string>>
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly turnState: Ref.Ref<CopilotTurnState>
	readonly transport: CopilotAcpHandle
}

const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: COPILOT_PROVIDER_ID,
		operation,
		detail
	})

const jsonObjectFromValue = <A>(value: A): JsonObject => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return exit.value
	}
	return EMPTY_JSON_OBJECT
}

const stringField = (record: JsonObject, key: string): Option.Option<string> => {
	const value = record[key]
	if (Predicate.isString(value) && Str.isNonEmpty(Str.trim(value))) {
		return Option.some(value)
	}
	return Option.none()
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

const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
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

const makeMetaEvent = Effect.fn("CopilotAdapter.makeMetaEvent")(function*(
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

const makeMessageSent = Effect.fn("CopilotAdapter.makeMessageSent")(function*(
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

const makeCancelled = Effect.fn("CopilotAdapter.makeCancelled")(function*(runtime: SessionRuntime) {
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

const publishFact = Effect.fn("CopilotAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CopilotContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const publishAcpMessage = Effect.fn("CopilotAdapter.publishAcpMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const facts = mapAcpUpdate(raw)
	yield* Effect.forEach(facts, (fact) => publishFact(runtime, fact), { discard: true })
})

const requireSession = Effect.fn("CopilotAdapter.requireSession")(function*(
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

const promptParams = (providerSessionId: string, text: string): JsonObject => ({
	sessionId: providerSessionId,
	prompt: [
		{
			type: "text",
			text
		}
	]
})

const cancelParams = (providerSessionId: string): JsonObject => ({
	sessionId: providerSessionId
})

const sessionNewResultId = (result: Json): Option.Option<string> =>
	stringField(jsonObjectFromValue(result), "sessionId")

export const makeCopilotAdapter = Effect.fn("makeCopilotAdapter")(function*(
	options: CopilotAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const settlePrompt = Effect.fn("CopilotAdapter.settlePrompt")(function*(
		runtime: SessionRuntime,
		seq: number,
		result: Json
	) {
		const terminal = mapPromptResult(result)
		const stopReason =
			terminal.contractKind === "turn_error" ? terminal.detail : "end_turn"
		const settled = yield* Ref.modify(runtime.turnState, (state) => {
			const next = completeCopilotPrompt(state, seq, stopReason)
			return [next, next.state] as const
		})
		if (settled.emitComplete) {
			yield* publishFact(runtime, terminal)
		}
	})

	const openSession = Effect.fn("CopilotAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Copilot session '${request.sessionId}' is already open.`
			)
		}
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		const turnState = yield* Ref.make(emptyCopilotTurnState)
		const providerSessionId = yield* Ref.make(Option.none<string>())
		const transport = yield* options.createTransport({ cwd: request.workspaceRoot })
		const created = yield* transport.request(
			"session/new",
			copilotSessionNewParams(request.workspaceRoot)
		)
		const acpSessionId = sessionNewResultId(created)
		if (Option.isNone(acpSessionId)) {
			return yield* adapterError("startSession", "Copilot session/new did not return a session id.")
		}
		yield* Ref.set(providerSessionId, acpSessionId)
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			providerSessionId,
			outbound,
			lastUserMessageId,
			sequence,
			turnState,
			transport
		}
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, request.sessionId)
		)
		yield* transport.notifications.pipe(
			Stream.runForEach((raw) => publishAcpMessage(runtime, raw)),
			Effect.ensuring(
				Queue.end(runtime.outbound).pipe(
					Effect.flatMap(() => dropSession),
					Effect.asVoid
				)
			),
			Effect.forkChild({ startImmediately: true })
		)
		return runtime
	})

	const startSession = (request: StartSessionRequest) =>
		Stream.unwrap(
			Effect.gen(function*() {
				const runtime = yield* openSession(request)
				const providerId = yield* Ref.get(runtime.providerSessionId)
				const opened = yield* makeMetaEvent(
					runtime,
					providerSessionFact(Option.getOrElse(providerId, () => request.sessionId))
				)
				return Stream.concat(Stream.make(opened), Stream.fromQueue(runtime.outbound))
			})
		)

	const transportPrompt = (
		runtime: SessionRuntime,
		providerSessionId: string,
		text: string,
		seq: number
	) =>
		runtime.transport
			.request("session/prompt", promptParams(providerSessionId, text))
			.pipe(
				Effect.flatMap((result) => settlePrompt(runtime, seq, result)),
				Effect.ignore,
				Effect.forkChild({ startImmediately: true })
			)

	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				const acpSessionId = yield* Ref.get(runtime.providerSessionId)
				if (Option.isNone(acpSessionId)) {
					return yield* adapterError("sendPrompt", "Copilot ACP session id is missing.")
				}
				const begun = yield* Ref.modify(runtime.turnState, (state) => {
					const next = beginCopilotPrompt(
						state,
						TurnId.make(`${runtime.sessionId}:turn:${state.promptSequence + 1}`)
					)
					return [next, next.state] as const
				})
				yield* transportPrompt(runtime, acpSessionId.value, request.text, begun.seq)
				return yield* makeMessageSent(runtime, request)
			})
		)

	const cancelTurn = Effect.fn("CopilotAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const acpSessionId = yield* Ref.get(runtime.providerSessionId)
		if (Option.isSome(acpSessionId)) {
			yield* runtime.transport.notify("session/cancel", cancelParams(acpSessionId.value)).pipe(
				Effect.ignore
			)
		}
		yield* Ref.set(runtime.turnState, cancelCopilotTurn(yield* Ref.get(runtime.turnState)))
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
	})

	return {
		providerId: COPILOT_PROVIDER_ID,
		capabilities: COPILOT_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn
	} satisfies ProviderAdapter
})
