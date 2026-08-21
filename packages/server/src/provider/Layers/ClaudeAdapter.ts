import { query } from "@anthropic-ai/claude-agent-sdk"
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
	tracerAssistantMessageId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
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
	CLAUDE_CAPABILITIES,
	CLAUDE_PROVIDER_ID,
	probeClaudePresence
} from "./ClaudeProvider.ts"
import {
	type ClaudeContractFact,
	type ClaudeStreamState,
	deferredOpenFact,
	emptyClaudeStreamState,
	encodeContractFact,
	mapSdkMessage,
	permissionRequestFact
} from "./ClaudeSdkMap.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const EMPTY_JSON_OBJECT: JsonObject = {}

export type ClaudePermissionDecision = "allow" | "deny"

export type ClaudePermissionResult =
	| {
			readonly behavior: "allow"
			readonly updatedInput: JsonObject
	  }
	| {
			readonly behavior: "deny"
			readonly message: string
	  }

export type ClaudeCanUseTool = (
	toolName: string,
	input: JsonObject,
	options: { readonly toolUseID: string }
) => Promise<ClaudePermissionResult>

export type ClaudeUserPrompt = {
	readonly type: "user"
	readonly session_id: string
	readonly parent_tool_use_id: null
	readonly message: {
		readonly role: "user"
		readonly content: string
	}
}

export type ClaudeQueryInput = {
	readonly prompt: AsyncIterable<ClaudeUserPrompt>
	readonly cwd: string
	readonly canUseTool: ClaudeCanUseTool
}

export type ClaudeQueryHandle = {
	readonly messages: Stream.Stream<Json, ProviderAdapterError>
	readonly interrupt: Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export type ClaudeAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: ClaudePermissionDecision
	}) => Effect.Effect<void, ProviderAdapterError>
}

export type ClaudeAdapterOptions = {
	readonly createQuery: (
		input: ClaudeQueryInput
	) => Effect.Effect<ClaudeQueryHandle, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
}

type SessionRuntime = {
	readonly sessionId: SessionId
	readonly promptQueue: Queue.Queue<ClaudeUserPrompt, Done>
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly streamState: Ref.Ref<ClaudeStreamState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<ClaudePermissionDecision>>
	>
	readonly query: ClaudeQueryHandle
}

const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CLAUDE_PROVIDER_ID,
		operation,
		detail
	})

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

const jsonObjectFromValue = <A>(value: A): JsonObject => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return exit.value
	}
	return EMPTY_JSON_OBJECT
}

const userPrompt = (text: string, providerSessionId: Option.Option<string>): ClaudeUserPrompt => ({
	type: "user",
	session_id: Option.getOrElse(providerSessionId, () => ""),
	parent_tool_use_id: null,
	message: {
		role: "user",
		content: text
	}
})

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

const stamp = Effect.fn("ClaudeAdapter.stamp")(function*(runtime: SessionRuntime) {
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

const makeTokenEvent = Effect.fn("ClaudeAdapter.makeTokenEvent")(function*(
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

const makeMetaEvent = Effect.fn("ClaudeAdapter.makeMetaEvent")(function*(
	runtime: SessionRuntime,
	fact: ClaudeContractFact
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

const makeMessageSent = Effect.fn("ClaudeAdapter.makeMessageSent")(function*(
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

const makeCancelled = Effect.fn("ClaudeAdapter.makeCancelled")(function*(runtime: SessionRuntime) {
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

const publishFact = Effect.fn("ClaudeAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: ClaudeContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const publishSdkMessage = Effect.fn("ClaudeAdapter.publishSdkMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const state = yield* Ref.get(runtime.streamState)
	const mapped = mapSdkMessage(state, raw)
	yield* Ref.set(runtime.streamState, mapped.state)
	yield* Effect.forEach(mapped.facts, (fact) => publishFact(runtime, fact), { discard: true })
})

const requireSession = Effect.fn("ClaudeAdapter.requireSession")(function*(
	sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionRuntime>>,
	sessionId: SessionId,
	operation: ProviderAdapterError["operation"]
) {
	const map = yield* Ref.get(sessions)
	const found = HashMap.get(map, sessionId)
	if (Option.isNone(found)) {
		return yield* adapterError(operation, `No Claude session '${sessionId}'.`)
	}
	return found.value
})

const bindCanUseTool = (
	runtimeHolder: Ref.Ref<Option.Option<SessionRuntime>>,
	decide: (
		runtime: SessionRuntime,
		toolName: string,
		toolInput: JsonObject,
		toolUseID: string
	) => Effect.Effect<ClaudePermissionResult>
): ClaudeCanUseTool =>
	(toolName, toolInput, toolOptions) =>
		Effect.runPromise(
			Effect.gen(function*() {
				const held = yield* Ref.get(runtimeHolder)
				if (Option.isNone(held)) {
					return {
						behavior: "deny" as const,
						message: "Claude session is not ready."
					}
				}
				return yield* decide(held.value, toolName, toolInput, toolOptions.toolUseID)
			})
		)

export const liveCreateQuery = (
	input: ClaudeQueryInput
): Effect.Effect<ClaudeQueryHandle, ProviderAdapterError> =>
	Effect.try({
		try: () => {
			const runtime = query({
				prompt: input.prompt,
				options: {
					cwd: input.cwd,
					includePartialMessages: true,
					canUseTool: (toolName, toolInput, options) =>
						input.canUseTool(toolName, jsonObjectFromValue(toolInput), {
							toolUseID: options.toolUseID
						})
				}
			})
			return {
				messages: Stream.fromAsyncIterable(runtime, (cause) =>
					adapterError("startSession", errorDetail(cause, "Claude query stream failed"))
				).pipe(
					Stream.mapEffect((message) =>
						Schema.decodeUnknownEffect(Schema.Json)(message).pipe(
							Effect.mapError(() =>
								adapterError("startSession", "Claude query message was not JSON")
							)
						)
					)
				),
				interrupt: Effect.tryPromise({
					try: () => runtime.interrupt(),
					catch: (cause) =>
						adapterError("cancelTurn", errorDetail(cause, "Claude interrupt failed"))
				}),
				close: Effect.sync(() => {
					runtime.close()
				})
			}
		},
		catch: (cause) => adapterError("startSession", errorDetail(cause, "Claude query failed"))
	})

export const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function*(
	options: ClaudeAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const decidePermission = Effect.fn("ClaudeAdapter.decidePermission")(function*(
		runtime: SessionRuntime,
		toolName: string,
		toolInput: JsonObject,
		toolUseID: string
	) {
		const deferred = yield* Deferred.make<ClaudePermissionDecision>()
		const fact = permissionRequestFact({
			sessionId: runtime.sessionId,
			toolCallId: toolUseID,
			toolName
		})
		yield* Ref.update(runtime.pendingPermissions, (current) =>
			HashMap.set(current, fact.id, deferred)
		)
		yield* publishFact(runtime, fact)
		const decision = yield* Deferred.await(deferred)
		if (decision === "allow") {
			return {
				behavior: "allow" as const,
				updatedInput: toolInput
			}
		}
		return {
			behavior: "deny" as const,
			message: "User declined tool execution."
		}
	})

	const openSession = Effect.fn("ClaudeAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Claude session '${request.sessionId}' is already open.`
			)
		}
		const promptQueue = yield* Queue.unbounded<ClaudeUserPrompt, Done>()
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const streamState = yield* Ref.make(emptyClaudeStreamState)
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		const pendingPermissions = yield* Ref.make(
			HashMap.empty<string, Deferred.Deferred<ClaudePermissionDecision>>()
		)
		const runtimeHolder = yield* Ref.make(Option.none<SessionRuntime>())
		const queryHandle = yield* options.createQuery({
			prompt: Stream.toAsyncIterable(Stream.fromQueue(promptQueue)),
			cwd: request.workspaceRoot,
			canUseTool: bindCanUseTool(runtimeHolder, decidePermission)
		})
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			promptQueue,
			outbound,
			streamState,
			lastUserMessageId,
			sequence,
			pendingPermissions,
			query: queryHandle
		}
		yield* Ref.set(runtimeHolder, Option.some(runtime))
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, request.sessionId)
		)
		yield* queryHandle.messages.pipe(
			Stream.runForEach((raw) => publishSdkMessage(runtime, raw)),
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
				const opened = yield* makeMetaEvent(runtime, deferredOpenFact)
				return Stream.concat(Stream.make(opened), Stream.fromQueue(runtime.outbound))
			})
		)

	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				const state = yield* Ref.get(runtime.streamState)
				yield* Queue.offer(runtime.promptQueue, userPrompt(request.text, state.providerSessionId))
				return yield* makeMessageSent(runtime, request)
			})
		)

	const cancelTurn = Effect.fn("ClaudeAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
		yield* runtime.query.interrupt.pipe(Effect.ignore)
		yield* Queue.end(runtime.outbound).pipe(Effect.asVoid)
		yield* runtime.query.close
		yield* Ref.update(sessions, (current) => HashMap.remove(current, request.sessionId))
	})

	const respondToPermission = Effect.fn("ClaudeAdapter.respondToPermission")(function*(input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: ClaudePermissionDecision
	}) {
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		const pending = yield* Ref.get(runtime.pendingPermissions)
		const deferred = HashMap.get(pending, input.permissionId)
		if (Option.isNone(deferred)) {
			return yield* adapterError(
				"sendPrompt",
				`No permission request '${input.permissionId}'.`
			)
		}
		yield* Deferred.succeed(deferred.value, input.decision)
		yield* Ref.update(runtime.pendingPermissions, (current) =>
			HashMap.remove(current, input.permissionId)
		)
	})

	return {
		providerId: CLAUDE_PROVIDER_ID,
		capabilities: CLAUDE_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission
	} satisfies ClaudeAdapter
})

export const makeLiveClaudeAdapter = Effect.fn("makeLiveClaudeAdapter")(function*() {
	const presenceValue = yield* probeClaudePresence()
	return yield* makeClaudeAdapter({
		createQuery: liveCreateQuery,
		presence: Effect.succeed(presenceValue)
	})
})
