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
import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type StartSessionRequest
} from "../Services/ProviderAdapter.ts"
import {
	type CodexContractFact,
	type CodexMapState,
	emptyCodexMapState,
	encodeContractFact,
	mapCodexServerMessage,
	providerSessionFact
} from "./CodexNativeMap.ts"
import {
	buildCodexInitializeParams,
	buildCodexTurnStartParams,
	buildThreadStartParams,
	buildTurnInterruptParams,
	CODEX_CAPABILITIES,
	CODEX_PROVIDER_ID,
	CODEX_REQUEST_TIMEOUT_SECONDS,
	type CodexNativeConfigState,
	defaultCodexNativeConfigState,
	mapCodexPermissionReply,
	parseThreadId,
	parseTurnId,
	probeCodexPresence,
	resolveCodexSpawnConfig
} from "./CodexProvider.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const encodeJsonLine = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Json))
const EMPTY_JSON_OBJECT: JsonObject = {}
const isJsonObject = Schema.is(Schema.JsonObject)

export type CodexAppServerInput = {
	readonly cwd: string
	readonly command: string
	readonly args: ReadonlyArray<string>
}

export type CodexJsonRpcRequest = {
	readonly operation: ProviderAdapterError["operation"]
	readonly method: string
	readonly params: Json
}

export type CodexAppServerHandle = {
	readonly notifications: Stream.Stream<Json, ProviderAdapterError>
	readonly request: (input: CodexJsonRpcRequest) => Effect.Effect<Json, ProviderAdapterError>
	readonly notify: (
		method: string,
		params: Option.Option<Json>
	) => Effect.Effect<void, ProviderAdapterError>
	readonly reply: (id: Json, result: Json) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export type CodexAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: string
	}) => Effect.Effect<void, ProviderAdapterError>
	readonly respondToQuestion: (input: {
		readonly sessionId: SessionId
		readonly requestId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}) => Effect.Effect<void, ProviderAdapterError>
}

export type CodexAdapterOptions = {
	readonly createAppServer: (
		input: CodexAppServerInput
	) => Effect.Effect<CodexAppServerHandle, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
	readonly spawn: {
		readonly command: string
		readonly args: ReadonlyArray<string>
	}
	readonly config: CodexNativeConfigState
}

type PendingRequest = {
	readonly operation: ProviderAdapterError["operation"]
	readonly deferred: Deferred.Deferred<Json, ProviderAdapterError>
}

type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly mapState: Ref.Ref<CodexMapState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly providerThreadId: Ref.Ref<Option.Option<string>>
	readonly currentTurnId: Ref.Ref<Option.Option<string>>
	readonly questionIds: Ref.Ref<HashMap.HashMap<string, ReadonlyArray<string>>>
	readonly modeId: Ref.Ref<string>
	readonly config: CodexNativeConfigState
	readonly server: CodexAppServerHandle
}

const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CODEX_PROVIDER_ID,
		operation,
		detail
	})

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

const jsonField = (record: JsonObject, key: string): Option.Option<Json> => {
	const value = record[key]
	if (value === undefined) {
		return Option.none()
	}
	return Option.some(value)
}

const parseRequestId = (value: Json): Option.Option<string> => {
	if (Predicate.isNumber(value)) {
		return Option.some(String(value))
	}
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

const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
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

const makeMetaEvent = Effect.fn("CodexAdapter.makeMetaEvent")(function*(
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

const makeMessageSent = Effect.fn("CodexAdapter.makeMessageSent")(function*(
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

const makeCancelled = Effect.fn("CodexAdapter.makeCancelled")(function*(
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

const publishFact = Effect.fn("CodexAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CodexContractFact
) {
	yield* rememberQuestionIds(runtime, fact)
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const publishServerMessage = Effect.fn("CodexAdapter.publishServerMessage")(function*(
	runtime: SessionRuntime,
	raw: Json
) {
	const state = yield* Ref.get(runtime.mapState)
	const mapped = mapCodexServerMessage(state, runtime.sessionId, raw)
	yield* Ref.set(runtime.mapState, mapped.state)
	yield* Effect.forEach(mapped.facts, (fact) => publishFact(runtime, fact), { discard: true })
})

const requireSession = Effect.fn("CodexAdapter.requireSession")(function*(
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

const writeJsonLine = Effect.fn("CodexAdapter.writeJsonLine")(function*(
	outbound: Queue.Queue<string, Done>,
	value: Json,
	operation: ProviderAdapterError["operation"]
) {
	const line = yield* encodeJsonLine(value).pipe(
		Effect.mapError(() => adapterError(operation, "Codex JSON-RPC payload was not JSON"))
	)
	yield* Queue.offer(outbound, line)
})

export const makeCodexAdapter = Effect.fn("makeCodexAdapter")(function*(
	options: CodexAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const openSession = Effect.fn("CodexAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Codex session '${request.sessionId}' is already open.`
			)
		}
		const server = yield* options.createAppServer({
			cwd: request.workspaceRoot,
			command: options.spawn.command,
			args: options.spawn.args
		})
		yield* server.request({
			operation: "startSession",
			method: "initialize",
			params: buildCodexInitializeParams()
		})
		yield* server.notify("initialized", Option.none())
		const threadResult = yield* server.request({
			operation: "startSession",
			method: "thread/start",
			params: buildThreadStartParams(request.workspaceRoot)
		})
		const threadId = parseThreadId(threadResult)
		if (Option.isNone(threadId)) {
			yield* server.close
			return yield* adapterError(
				"startSession",
				"Codex thread open response did not include a thread id"
			)
		}
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			outbound,
			mapState: yield* Ref.make(emptyCodexMapState),
			lastUserMessageId: yield* Ref.make(Option.none<MessageId>()),
			sequence: yield* Ref.make(0),
			providerThreadId: yield* Ref.make(Option.some(threadId.value)),
			currentTurnId: yield* Ref.make(Option.none<string>()),
			questionIds: yield* Ref.make(HashMap.empty<string, ReadonlyArray<string>>()),
			modeId: yield* Ref.make("agent"),
			config: options.config,
			server
		}
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, request.sessionId)
		)
		yield* server.notifications.pipe(
			Stream.runForEach((raw) => publishServerMessage(runtime, raw)),
			Effect.ensuring(
				Queue.end(runtime.outbound).pipe(
					Effect.flatMap(() => dropSession),
					Effect.flatMap(() => server.close),
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
				const threadId = yield* Ref.get(runtime.providerThreadId)
				const opened = yield* makeMetaEvent(
					runtime,
					providerSessionFact(Option.getOrElse(threadId, () => request.sessionId))
				)
				return Stream.concat(Stream.make(opened), Stream.fromQueue(runtime.outbound))
			})
		)

	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				const threadId = yield* Ref.get(runtime.providerThreadId)
				if (Option.isNone(threadId)) {
					return yield* adapterError(
						"sendPrompt",
						"Codex session is missing a provider thread id"
					)
				}
				const modeId = yield* Ref.get(runtime.modeId)
				const result = yield* runtime.server.request({
					operation: "sendPrompt",
					method: "turn/start",
					params: buildCodexTurnStartParams({
						threadId: threadId.value,
						text: request.text,
						state: runtime.config,
						modeId
					})
				})
				const turnId = parseTurnId(result)
				if (Option.isNone(turnId)) {
					return yield* adapterError(
						"sendPrompt",
						"turn/start response did not include a turn id"
					)
				}
				yield* Ref.set(runtime.currentTurnId, Option.some(turnId.value))
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				return yield* makeMessageSent(runtime, request)
			})
		)

	const cancelTurn = Effect.fn("CodexAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const threadId = yield* Ref.get(runtime.providerThreadId)
		const turnId = yield* Ref.get(runtime.currentTurnId)
		if (Option.isNone(threadId)) {
			return yield* adapterError(
				"cancelTurn",
				"Codex session is missing a provider thread id"
			)
		}
		if (Option.isNone(turnId)) {
			return yield* adapterError("cancelTurn", "Codex session is missing an active turn id")
		}
		yield* runtime.server.request({
			operation: "cancelTurn",
			method: "turn/interrupt",
			params: buildTurnInterruptParams(threadId.value, turnId.value)
		})
		yield* Ref.set(runtime.currentTurnId, Option.none())
		const cancelled = yield* makeCancelled(runtime, turnId)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
	})

	const respondToPermission = Effect.fn("CodexAdapter.respondToPermission")(function*(input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: string
	}) {
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		const mapped = mapCodexPermissionReply(input.decision)
		if (Option.isNone(mapped)) {
			return yield* adapterError(
				"sendPrompt",
				`Unsupported Codex permission reply: ${input.decision}`
			)
		}
		const decodedId = Schema.decodeUnknownExit(Schema.NumberFromString)(input.permissionId)
		if (Exit.isFailure(decodedId)) {
			return yield* adapterError(
				"sendPrompt",
				`Invalid Codex permission request id: ${input.permissionId}`
			)
		}
		yield* runtime.server.reply(decodedId.value, { decision: mapped.value })
	})

	const respondToQuestion = Effect.fn("CodexAdapter.respondToQuestion")(function*(input: {
		readonly sessionId: SessionId
		readonly requestId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}) {
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		const pending = yield* Ref.get(runtime.questionIds)
		const questionIds = HashMap.get(pending, input.requestId)
		if (Option.isNone(questionIds)) {
			return yield* adapterError(
				"sendPrompt",
				"Codex question ids were not available for the reply"
			)
		}
		if (questionIds.value.length < input.answers.length) {
			return yield* adapterError(
				"sendPrompt",
				"Codex question reply included more answers than questions"
			)
		}
		const pairs = Arr.zip(questionIds.value, input.answers)
		const answers = yield* Schema.decodeUnknownEffect(Schema.JsonObject)(
			Object.fromEntries(
				Arr.map(pairs, (pair) => [pair[0], { answers: Arr.fromIterable(pair[1]) }])
			)
		).pipe(
			Effect.mapError(() =>
				adapterError("sendPrompt", "Codex question reply was not JSON")
			)
		)
		const decodedId = Schema.decodeUnknownExit(Schema.NumberFromString)(input.requestId)
		if (Exit.isFailure(decodedId)) {
			return yield* adapterError(
				"sendPrompt",
				`Invalid Codex question request id: ${input.requestId}`
			)
		}
		yield* runtime.server.reply(decodedId.value, { answers })
		yield* Ref.update(runtime.questionIds, (current) => HashMap.remove(current, input.requestId))
	})

	return {
		providerId: CODEX_PROVIDER_ID,
		capabilities: CODEX_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission,
		respondToQuestion
	} satisfies CodexAdapter
})

type LivePending = Ref.Ref<HashMap.HashMap<string, PendingRequest>>

const failPending = Effect.fn("CodexAdapter.failPending")(function*(
	pending: LivePending,
	detail: string
) {
	const current = yield* Ref.get(pending)
	yield* Ref.set(pending, HashMap.empty())
	yield* Effect.forEach(
		HashMap.values(current),
		(entry) => Deferred.fail(entry.deferred, adapterError(entry.operation, detail)),
		{ discard: true }
	)
})

const handleStdoutLine = Effect.fn("CodexAdapter.handleStdoutLine")(function*(
	line: string,
	pending: LivePending,
	notifications: Queue.Queue<Json, Done>
) {
	const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(line).pipe(
		Effect.option
	)
	if (Option.isNone(decoded)) {
		const reason = `Received invalid JSON from codex app-server: ${line}`
		yield* failPending(pending, reason)
		yield* Queue.offer(notifications, {
			method: "error",
			params: {
				error: { message: reason }
			}
		})
		yield* Queue.end(notifications)
		return
	}
	const message = decoded.value
	if (isJsonObject(message) === false) {
		yield* Queue.offer(notifications, message)
		return
	}
	const id = Option.flatMap(jsonField(message, "id"), parseRequestId)
	const hasResult = Option.isSome(jsonField(message, "result"))
	const hasError = Option.isSome(jsonField(message, "error"))
	if (Option.isSome(id) && (hasResult || hasError)) {
		const current = yield* Ref.get(pending)
		const entry = HashMap.get(current, id.value)
		if (Option.isSome(entry)) {
			yield* Ref.update(pending, (map) => HashMap.remove(map, id.value))
			if (hasError) {
				yield* Deferred.fail(
					entry.value.deferred,
					adapterError(entry.value.operation, `JSON-RPC error for id ${id.value}`)
				)
				return
			}
			const result = Option.getOrElse(jsonField(message, "result"), () => EMPTY_JSON_OBJECT)
			yield* Deferred.succeed(entry.value.deferred, result)
			return
		}
	}
	yield* Queue.offer(notifications, message)
})

export const liveCreateAppServer = (
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	layerScope: Scope.Scope,
	input: CodexAppServerInput
): Effect.Effect<CodexAppServerHandle, ProviderAdapterError> =>
	Effect.gen(function*() {
		const outbound = yield* Queue.unbounded<string, Done>()
		const notifications = yield* Queue.unbounded<Json, Done>()
		const pending = yield* Ref.make(HashMap.empty<string, PendingRequest>())
		const requestId = yield* Ref.make(0)
		const stderrText = yield* Ref.make("")
		const child = yield* spawner
			.spawn(
				ChildProcess.make(input.command, Arr.fromIterable(input.args), {
					cwd: input.cwd,
					extendEnv: true,
					detached: false
				})
			)
			.pipe(
				Effect.provideService(Scope.Scope, layerScope),
				Effect.mapError((cause) =>
					adapterError("startSession", errorDetail(cause, "Failed to spawn Codex"))
				)
			)
		yield* Stream.fromQueue(outbound).pipe(
			Stream.map((line) => `${line}\n`),
			Stream.encodeText,
			Stream.run(child.stdin),
			Effect.forkIn(layerScope, { startImmediately: true })
		)
		yield* child.stderr.pipe(
			Stream.decodeText,
			Stream.runForEach((chunk) => Ref.update(stderrText, (current) => `${current}${chunk}`)),
			Effect.forkIn(layerScope, { startImmediately: true })
		)
		yield* child.stdout.pipe(
			Stream.decodeText,
			Stream.splitLines,
			Stream.filter((line) => Str.isNonEmpty(Str.trim(line))),
			Stream.runForEach((line) =>
				handleStdoutLine(line, pending, notifications).pipe(Effect.ignore)
			),
			Effect.ensuring(
				Effect.gen(function*() {
					const stderr = yield* Ref.get(stderrText)
					const reason =
						Str.isNonEmpty(Str.trim(stderr))
							? `Codex app-server exited unexpectedly:\n${stderr}`
							: "Codex app-server exited unexpectedly"
					yield* failPending(pending, reason)
					yield* Queue.offer(notifications, {
						method: "error",
						params: {
							error: { message: reason }
						}
					}).pipe(Effect.ignore)
					yield* Queue.end(notifications)
				})
			),
			Effect.forkIn(layerScope, { startImmediately: true })
		)
		const request = (rpc: CodexJsonRpcRequest) =>
			Effect.gen(function*() {
				const id = yield* Ref.updateAndGet(requestId, (current) => current + 1)
				const deferred = yield* Deferred.make<Json, ProviderAdapterError>()
				yield* Ref.update(pending, (current) =>
					HashMap.set(current, String(id), {
						operation: rpc.operation,
						deferred
					})
				)
				yield* writeJsonLine(
					outbound,
					{
						id,
						method: rpc.method,
						params: rpc.params
					},
					rpc.operation
				)
				return yield* Deferred.await(deferred).pipe(
					Effect.timeoutOrElse({
						duration: Duration.seconds(CODEX_REQUEST_TIMEOUT_SECONDS),
						orElse: () =>
							adapterError(
								rpc.operation,
								`${rpc.method} (after ${String(CODEX_REQUEST_TIMEOUT_SECONDS)}s)`
							)
					})
				)
			})
		const notify = (method: string, params: Option.Option<Json>) =>
			Option.match(params, {
				onNone: () => writeJsonLine(outbound, { method }, "startSession"),
				onSome: (value) =>
					writeJsonLine(outbound, { method, params: value }, "startSession")
			})
		const reply = (id: Json, result: Json) =>
			writeJsonLine(outbound, { id, result }, "sendPrompt")
		const close = Effect.gen(function*() {
			yield* Queue.end(outbound).pipe(Effect.ignore)
			yield* child.kill().pipe(Effect.ignore)
			yield* failPending(pending, "Codex client stopped")
			yield* Queue.end(notifications).pipe(Effect.ignore)
		}).pipe(Effect.asVoid)
		return {
			notifications: Stream.fromQueue(notifications),
			request,
			notify,
			reply,
			close
		}
	})

export type CodexLiveOptions = {
	readonly cacheDir: Option.Option<string>
	readonly command: Option.Option<string>
	readonly args: Option.Option<ReadonlyArray<string>>
	readonly config: Option.Option<CodexNativeConfigState>
}

export const makeLiveCodexAdapter = Effect.fn("makeLiveCodexAdapter")(function*(
	options: CodexLiveOptions
) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const layerScope = yield* Effect.scope
	const presenceValue = yield* probeCodexPresence(options.cacheDir)
	const resolved = yield* resolveCodexSpawnConfig(options.cacheDir)
	const command = Option.getOrElse(options.command, () => resolved.command)
	const args = Option.getOrElse(options.args, () => resolved.args)
	const config = Option.getOrElse(options.config, defaultCodexNativeConfigState)
	return yield* makeCodexAdapter({
		createAppServer: (input) =>
			liveCreateAppServer(spawner, layerScope, {
				cwd: input.cwd,
				command,
				args
			}),
		presence: Effect.succeed(presenceValue),
		spawn: {
			command,
			args
		},
		config
	})
})
