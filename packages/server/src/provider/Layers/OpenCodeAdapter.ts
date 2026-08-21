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
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Rec from "effect/Record"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
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
	buildPromptBody,
	consumeSseLine,
	emptyOpenCodeStreamState,
	emptySseLineFold,
	encodeContractFact,
	isSafeRequestId,
	mapSseJson,
	type OpenCodeContractFact,
	type OpenCodePermissionReply,
	type OpenCodePromptBody,
	type OpenCodeSessionRecord,
	OpenCodeSessionRecord as OpenCodeSessionRecordSchema,
	type OpenCodeStreamState,
	openCodeUrls,
	parseModelSelection,
	providerSessionFact,
	resolveConfiguredModel,
	sessionCatalogFact,
	sseSessionId
} from "./OpenCodeMap.ts"
import {
	OPENCODE_ALLOWED_ENV_KEYS,
	OPENCODE_CAPABILITIES,
	OPENCODE_DEFAULT_MODE,
	OPENCODE_PLACEHOLDER_BINARY,
	OPENCODE_PROVIDER_ID,
	openCodeServeArgs,
	parseServeUrl,
	probeOpenCodeBinary,
	probeOpenCodePresence
} from "./OpenCodeProvider.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}
const READY_TIMEOUT = Duration.millis(15_000)
const READY_INTERVAL = Duration.millis(200)
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

const OpenCodeProviderModel = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	name: Schema.String,
	capabilities: Schema.optionalKey(
		Schema.Struct({
			toolcall: Schema.optionalKey(Schema.Boolean)
		})
	)
})

const OpenCodeProviderEntry = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	models: Schema.Record(Schema.String, OpenCodeProviderModel)
})

const OpenCodeProviderResponse = Schema.Struct({
	connected: Schema.Array(Schema.String),
	all: Schema.Array(OpenCodeProviderEntry)
})

const OpenCodeConfigResponse = Schema.Struct({
	model: Schema.optionalKey(Schema.String)
})

const OpenCodeCommandResponse = Schema.Array(
	Schema.Struct({
		name: Schema.String,
		description: Schema.optionalKey(Schema.String)
	})
)

const decodeProviderResponse = Schema.decodeUnknownEffect(OpenCodeProviderResponse)
const decodeConfigResponse = Schema.decodeUnknownEffect(OpenCodeConfigResponse)
const decodeCommandResponse = Schema.decodeUnknownEffect(OpenCodeCommandResponse)

export type OpenCodeCatalogModel = {
	readonly modelId: string
	readonly name: string
}

export type OpenCodeCatalogCommand = {
	readonly name: string
	readonly description: string
}

export type OpenCodeModelCatalog = {
	readonly models: ReadonlyArray<OpenCodeCatalogModel>
	readonly currentModelId: Option.Option<string>
}

export type OpenCodeTransport = {
	readonly events: Stream.Stream<Json, ProviderAdapterError>
	readonly createSession: Effect.Effect<OpenCodeSessionRecord, ProviderAdapterError>
	readonly listModels: Effect.Effect<OpenCodeModelCatalog, ProviderAdapterError>
	readonly listCommands: Effect.Effect<ReadonlyArray<OpenCodeCatalogCommand>, ProviderAdapterError>
	readonly sendPrompt: (
		providerSessionId: string,
		body: OpenCodePromptBody
	) => Effect.Effect<void, ProviderAdapterError>
	readonly abort: (providerSessionId: string) => Effect.Effect<void, ProviderAdapterError>
	readonly replyPermission: (
		requestId: string,
		reply: OpenCodePermissionReply
	) => Effect.Effect<void, ProviderAdapterError>
	readonly replyQuestion: (
		requestId: string,
		answers: ReadonlyArray<ReadonlyArray<string>>
	) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export type OpenCodeAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly reply: OpenCodePermissionReply
	}) => Effect.Effect<void, ProviderAdapterError>
	readonly respondToQuestion: (input: {
		readonly sessionId: SessionId
		readonly questionId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}) => Effect.Effect<void, ProviderAdapterError>
}

export type OpenCodeAdapterOptions = {
	readonly createTransport: (input: {
		readonly workspaceRoot: string
	}) => Effect.Effect<OpenCodeTransport, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
}

type SessionRuntime = {
	readonly sessionId: SessionId
	readonly workspaceRoot: string
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly streamState: Ref.Ref<OpenCodeStreamState>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly transport: OpenCodeTransport
}

const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: OPENCODE_PROVIDER_ID,
		operation,
		detail
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

const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
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

const makeMetaEvent = Effect.fn("OpenCodeAdapter.makeMetaEvent")(function*(
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

const makeMessageSent = Effect.fn("OpenCodeAdapter.makeMessageSent")(function*(
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

const makeCancelled = Effect.fn("OpenCodeAdapter.makeCancelled")(function*(runtime: SessionRuntime) {
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

const publishFact = Effect.fn("OpenCodeAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: OpenCodeContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
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

const publishSse = Effect.fn("OpenCodeAdapter.publishSse")(function*(
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

const requireSession = Effect.fn("OpenCodeAdapter.requireSession")(function*(
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

const requireProviderSession = Effect.fn("OpenCodeAdapter.requireProviderSession")(function*(
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

export const makeOpenCodeAdapter = Effect.fn("makeOpenCodeAdapter")(function*(
	options: OpenCodeAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const openSession = Effect.fn("OpenCodeAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`OpenCode session '${request.sessionId}' is already open.`
			)
		}
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const streamState = yield* Ref.make(emptyOpenCodeStreamState)
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		const transport = yield* options.createTransport({
			workspaceRoot: request.workspaceRoot
		})
		const created = yield* transport.createSession
		if (created.directory !== request.workspaceRoot) {
			yield* transport.close
			return yield* adapterError(
				"startSession",
				`OpenCode session binding mismatch: expected directory ${request.workspaceRoot}, got ${created.directory}`
			)
		}
		const catalog = yield* transport.listModels
		const commands = yield* transport.listCommands
		const selectedModel = Option.flatMap(catalog.currentModelId, parseModelSelection)
		yield* Ref.set(streamState, {
			providerSessionId: Option.some(created.id),
			currentMode: OPENCODE_DEFAULT_MODE,
			selectedModel,
			roles: emptyOpenCodeStreamState.roles,
			partText: emptyOpenCodeStreamState.partText,
			partType: emptyOpenCodeStreamState.partType
		})
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			workspaceRoot: request.workspaceRoot,
			outbound,
			streamState,
			lastUserMessageId,
			sequence,
			transport
		}
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, request.sessionId)
		)
		yield* transport.events.pipe(
			Stream.runForEach((raw) => publishSse(runtime, raw)),
			Effect.ensuring(
				Queue.end(runtime.outbound).pipe(
					Effect.flatMap(() => dropSession),
					Effect.flatMap(() => transport.close),
					Effect.asVoid
				)
			),
			Effect.forkChild({ startImmediately: true })
		)
		return {
			runtime,
			created,
			catalog,
			commands
		}
	})

	const startSession = (request: StartSessionRequest) =>
		Stream.unwrap(
			Effect.gen(function*() {
				const opened = yield* openSession(request)
				const sessionFact = yield* makeMetaEvent(
					opened.runtime,
					providerSessionFact(opened.created.id)
				)
				const catalogFact = yield* makeMetaEvent(
					opened.runtime,
					sessionCatalogFact({
						models: opened.catalog.models,
						currentModelId: opened.catalog.currentModelId,
						currentModeId: OPENCODE_DEFAULT_MODE,
						commands: opened.commands
					})
				)
				return Stream.concat(
					Stream.make(sessionFact, catalogFact),
					Stream.fromQueue(opened.runtime.outbound)
				)
			})
		)

	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				const state = yield* Ref.get(runtime.streamState)
				if (Option.isNone(state.selectedModel)) {
					return yield* adapterError(
						"sendPrompt",
						"No model selected. A model must be set before sending a prompt."
					)
				}
				const providerSessionId = yield* requireProviderSession(runtime, "sendPrompt")
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				yield* runtime.transport.sendPrompt(
					providerSessionId,
					buildPromptBody({
						directory: runtime.workspaceRoot,
						model: state.selectedModel.value,
						agent: state.currentMode,
						text: request.text
					})
				)
				return yield* makeMessageSent(runtime, request)
			})
		)

	const cancelTurn = Effect.fn("OpenCodeAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const providerSessionId = yield* requireProviderSession(runtime, "cancelTurn")
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
		yield* runtime.transport.abort(providerSessionId).pipe(Effect.ignore)
		yield* Queue.end(runtime.outbound).pipe(Effect.asVoid)
		yield* runtime.transport.close
		yield* Ref.update(sessions, (current) => HashMap.remove(current, request.sessionId))
	})

	const respondToPermission = Effect.fn("OpenCodeAdapter.respondToPermission")(function*(input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly reply: OpenCodePermissionReply
	}) {
		if (isSafeRequestId(input.permissionId) === false) {
			return yield* adapterError(
				"sendPrompt",
				`Request ID '${input.permissionId}' contains invalid characters (only alphanumeric, '-', '_' allowed)`
			)
		}
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		yield* runtime.transport.replyPermission(input.permissionId, input.reply)
	})

	const respondToQuestion = Effect.fn("OpenCodeAdapter.respondToQuestion")(function*(input: {
		readonly sessionId: SessionId
		readonly questionId: string
		readonly answers: ReadonlyArray<ReadonlyArray<string>>
	}) {
		if (isSafeRequestId(input.questionId) === false) {
			return yield* adapterError(
				"sendPrompt",
				`Request ID '${input.questionId}' contains invalid characters (only alphanumeric, '-', '_' allowed)`
			)
		}
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		yield* runtime.transport.replyQuestion(input.questionId, input.answers)
	})

	return {
		providerId: OPENCODE_PROVIDER_ID,
		capabilities: OPENCODE_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission,
		respondToQuestion
	} satisfies OpenCodeAdapter
})

const COMPACT_COMMAND: OpenCodeCatalogCommand = {
	name: "compact",
	description: "compact the session"
}

const httpError = (
	operation: ProviderAdapterError["operation"],
	cause: { readonly message?: string },
	fallback: string
): ProviderAdapterError => {
	if (cause.message !== undefined && Str.isNonEmpty(cause.message)) {
		return adapterError(operation, cause.message)
	}
	return adapterError(operation, fallback)
}

const supportsToolCalls = (model: typeof OpenCodeProviderModel.Type): boolean => {
	if (model.capabilities === undefined || model.capabilities.toolcall === undefined) {
		return true
	}
	return model.capabilities.toolcall
}

const flattenProviderModels = (
	response: typeof OpenCodeProviderResponse.Type
): ReadonlyArray<OpenCodeCatalogModel> => {
	const connected = HashMap.fromIterable(Arr.map(response.connected, (id) => [id, true] as const))
	return Arr.flatMap(response.all, (provider) => {
		if (HashMap.has(connected, provider.id) === false) {
			return Arr.empty<OpenCodeCatalogModel>()
		}
		return Rec.reduce(
			provider.models,
			Arr.empty<OpenCodeCatalogModel>(),
			(acc, model, modelKey) => {
				if (supportsToolCalls(model) === false) {
					return acc
				}
				return Arr.append(acc, {
					modelId: `${provider.id}/${modelKey}`,
					name: model.name
				})
			}
		)
	})
}

const promptJson = (body: OpenCodePromptBody): JsonObject => ({
	directory: body.directory,
	model: {
		providerID: body.model.providerID,
		modelID: body.model.modelID
	},
	agent: body.agent,
	parts: Arr.map(body.parts, (part) => ({
		type: part.type,
		text: part.text
	}))
})

export const liveCreateTransport = Effect.fn("liveCreateTransport")(function*(input: {
	readonly workspaceRoot: string
	readonly command: string
	readonly args: ReadonlyArray<string>
	readonly env: Readonly<Record<string, string>>
	readonly http: HttpClient.HttpClient
	readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
}) {
	const scope = yield* Scope.make()
	const child = yield* input.spawner
		.spawn(
			ChildProcess.make(input.command, input.args, {
				cwd: input.workspaceRoot,
				env: input.env,
				extendEnv: false,
				detached: false
			})
		)
		.pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.mapError((cause) =>
				httpError("startSession", cause, "Failed to start OpenCode")
			)
		)
	const serveUrl = yield* child.stdout.pipe(
		Stream.decodeText,
		Stream.splitLines,
		Stream.filterMap(Filter.fromPredicateOption(parseServeUrl)),
		Stream.take(1),
		Stream.runHead,
		Effect.timeout(READY_TIMEOUT),
		Effect.mapError((cause) =>
			httpError("startSession", cause, "Failed to get port after starting")
		)
	)
	if (Option.isNone(serveUrl)) {
		yield* child.kill().pipe(Effect.ignore)
		yield* Scope.close(scope, Exit.succeed(undefined)).pipe(Effect.ignore)
		return yield* adapterError("startSession", "Failed to get port after starting")
	}
	const urls = openCodeUrls(
		`http://127.0.0.1:${String(serveUrl.value.port)}${serveUrl.value.apiPrefix}`
	)
	const http = input.http.pipe(HttpClient.filterStatusOk)
	yield* http.get(urls.config).pipe(
		Effect.asVoid,
		Effect.retry(Schedule.spaced(READY_INTERVAL)),
		Effect.timeout(READY_TIMEOUT),
		Effect.mapError((cause) =>
			httpError(
				"startSession",
				cause,
				`OpenCode not ready after ${String(Duration.toMillis(READY_TIMEOUT))}ms`
			)
		)
	)
	const postJson = Effect.fn("OpenCodeAdapter.postJson")(function*(
		operation: ProviderAdapterError["operation"],
		url: string,
		body: Json
	) {
		const encoded = yield* HttpBody.json(body).pipe(
			Effect.mapError((cause) =>
				httpError(operation, cause, "OpenCode request body was not JSON")
			)
		)
		return yield* http.post(url, { body: encoded }).pipe(
			Effect.mapError((cause) => httpError(operation, cause, "OpenCode HTTP request failed"))
		)
	})
	const events = HttpClientResponse.stream(
		http.get(urls.globalEvent, {
			accept: "text/event-stream",
			headers: {
				"accept-encoding": "identity"
			}
		})
	).pipe(
		Stream.decodeText,
		Stream.splitLines,
		Stream.mapAccum(() => emptySseLineFold, (fold, line) => {
			const consumed = consumeSseLine(fold, line)
			return [
				consumed.fold,
				Option.match(consumed.raw, {
					onNone: () => Arr.empty<string>(),
					onSome: (text) => Arr.of(text)
				})
			]
		}),
		Stream.mapError((cause) =>
			httpError("startSession", cause, "OpenCode SSE stream failed")
		),
		Stream.mapEffect((text) =>
			decodeJson(text).pipe(
				Effect.mapError(() => adapterError("startSession", "OpenCode SSE event was not JSON"))
			)
		)
	)
	const createSession = Effect.gen(function*() {
		const response = yield* postJson("startSession", urls.session, {
			directory: input.workspaceRoot
		})
		return yield* HttpClientResponse.schemaBodyJson(OpenCodeSessionRecordSchema)(response).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode session response was invalid")
			)
		)
	})
	const listModels = Effect.gen(function*() {
		const response = yield* http.get(urls.provider).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode provider catalog failed")
			)
		)
		const jsonBody = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode provider catalog was not JSON")
			)
		)
		const decoded = yield* decodeProviderResponse(jsonBody).pipe(
			Effect.mapError((cause) =>
				httpError("startSession", cause, "OpenCode provider catalog was invalid")
			)
		)
		const models = flattenProviderModels(decoded)
		const configResponse = yield* http.get(urls.config).pipe(
			Effect.flatMap((ok) => HttpClientResponse.schemaBodyJson(Schema.Json)(ok)),
			Effect.flatMap(decodeConfigResponse),
			Effect.option
		)
		const configured = Option.flatMap(configResponse, (config) =>
			config.model === undefined || Str.isEmpty(Str.trim(config.model))
				? Option.none<string>()
				: Option.some(config.model)
		)
		const currentModelId = Option.flatMap(configured, (modelId) =>
			resolveConfiguredModel(
				modelId,
				Arr.map(models, (model) => model.modelId)
			)
		)
		return {
			models,
			currentModelId
		}
	})
	const listCommands = Effect.gen(function*() {
		const response = yield* http
			.get(urls.command, {
				urlParams: [["directory", input.workspaceRoot]]
			})
			.pipe(Effect.option)
		if (Option.isNone(response)) {
			return [COMPACT_COMMAND]
		}
		const jsonBody = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response.value).pipe(
			Effect.option
		)
		if (Option.isNone(jsonBody)) {
			return [COMPACT_COMMAND]
		}
		const decoded = yield* decodeCommandResponse(jsonBody.value).pipe(Effect.option)
		if (Option.isNone(decoded)) {
			return [COMPACT_COMMAND]
		}
		return Arr.map(decoded.value, (command) => ({
			name: command.name,
			description: command.description === undefined ? "" : command.description
		}))
	})
	return {
		events,
		createSession,
		listModels,
		listCommands,
		sendPrompt: (providerSessionId, body) =>
			postJson("sendPrompt", urls.promptAsync(providerSessionId), promptJson(body)).pipe(
				Effect.asVoid
			),
		abort: (providerSessionId) =>
			postJson("cancelTurn", urls.abort(providerSessionId), {
				directory: input.workspaceRoot
			}).pipe(Effect.asVoid),
		replyPermission: (requestId, reply) =>
			postJson("sendPrompt", urls.permissionReply(requestId), { reply }).pipe(Effect.asVoid),
		replyQuestion: (requestId, answers) =>
			postJson("sendPrompt", urls.questionReply(requestId), { answers }).pipe(Effect.asVoid),
		close: child.kill().pipe(
			Effect.flatMap(() => Scope.close(scope, Exit.succeed(undefined))),
			Effect.ignore
		)
	} satisfies OpenCodeTransport
})

export const makeLiveOpenCodeAdapter = Effect.fn("makeLiveOpenCodeAdapter")(function*() {
	const presenceValue = yield* probeOpenCodePresence()
	const binary = yield* probeOpenCodeBinary()
	const command = Option.getOrElse(binary, () => OPENCODE_PLACEHOLDER_BINARY)
	const http = yield* HttpClient.HttpClient
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const envPairs = yield* Effect.forEach(OPENCODE_ALLOWED_ENV_KEYS, (key) =>
		Config.option(Config.string(key)).pipe(
			Effect.map((value) => Option.map(value, (text) => [key, text] as const))
		)
	)
	const env = Object.fromEntries(Arr.getSomes(envPairs))
	return yield* makeOpenCodeAdapter({
		presence: Effect.succeed(presenceValue),
		createTransport: (input) =>
			liveCreateTransport({
				workspaceRoot: input.workspaceRoot,
				command,
				args: openCodeServeArgs([]),
				env,
				http,
				spawner
			})
	})
})
