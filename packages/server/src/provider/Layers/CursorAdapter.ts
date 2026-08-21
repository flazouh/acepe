/**
 * Cursor ACP adapter. Official ACP session/update JSON becomes CONTRACT events.
 *
 * Accepted losses versus the handwritten Rust Cursor adapter (no recorded Cursor
 * harness fixture exists to grade these):
 * - cursor/ask_question, cursor/create_plan, cursor/update_todos, cursor/task,
 *   cursor/generate_image (and the underscore-prefixed forms)
 * - SQLite store.db sparse tool-call enrichment
 * - thinking-prefixed agent_message_chunk upgraded to thought chunks
 * - web-search notification dedup
 * - skills from ~/.cursor/skills
 * - model discovery via --list-models
 * - cursor_login beyond ACP authenticate
 * - history reconnect / provider-owned session snapshot
 * - ACP terminal methods (PTY is not wired; terminal capability is off)
 */
import {
	PROTOCOL_VERSION,
	client,
	methods,
	ndJsonStream
} from "@agentclientprotocol/sdk"
import type {
	ReadTextFileRequest,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionNotification,
	WriteTextFileRequest,
	WriteTextFileResponse
} from "@agentclientprotocol/sdk"
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
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import type { PlatformError } from "effect/PlatformError"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { AgentInstaller, type AgentInstallerShape } from "../Services/AgentInstaller.ts"
import {
	ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type StartSessionRequest
} from "../Services/ProviderAdapter.ts"
import {
	type CursorContractFact,
	encodeContractFact,
	mapAcpPermissionRequest,
	mapAcpSessionNotification,
	providerSessionFact,
	selectPermissionOptionId,
	turnCompleteFact
} from "./CursorAcpMap.ts"
import {
	CURSOR_CAPABILITIES,
	CURSOR_PROVIDER_ID,
	probeCursorAuthenticated,
	cursorPresence
} from "./CursorProvider.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJson = Schema.decodeUnknownExit(Schema.Json)
const EMPTY_JSON_OBJECT: JsonObject = {}

export const CURSOR_ACP_SDK_MODULE = "@agentclientprotocol/sdk"
export const CURSOR_ACP_PROTOCOL_VERSION = PROTOCOL_VERSION

export type CursorPermissionDecision = "allow" | "deny"

export type CursorStopReason =
	| "end_turn"
	| "max_tokens"
	| "max_turn_requests"
	| "refusal"
	| "cancelled"

export type CursorLaunchConfig = {
	readonly command: string
	readonly args: ReadonlyArray<string>
}

export type CursorConnectInput = {
	readonly launch: CursorLaunchConfig
	readonly onSessionUpdate: (notification: Json) => Effect.Effect<void>
	readonly onPermissionRequest: (request: Json) => Effect.Effect<CursorPermissionDecision>
}

export type CursorAcpHandle = {
	readonly initialize: Effect.Effect<void, ProviderAdapterError>
	readonly newSession: (cwd: string) => Effect.Effect<string, ProviderAdapterError>
	readonly prompt: (
		providerSessionId: string,
		text: string
	) => Effect.Effect<Option.Option<CursorStopReason>, ProviderAdapterError>
	readonly cancel: (providerSessionId: string) => Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export type CursorAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: CursorPermissionDecision
	}) => Effect.Effect<void, ProviderAdapterError>
}

export type CursorAdapterOptions = {
	readonly presence: Effect.Effect<ProviderPresence>
	readonly resolveLaunch: Effect.Effect<CursorLaunchConfig, ProviderAdapterError>
	readonly connect: (
		input: CursorConnectInput
	) => Effect.Effect<CursorAcpHandle, ProviderAdapterError>
}

type SessionRuntime = {
	readonly sessionId: SessionId
	readonly outbound: Queue.Queue<OrchestrationEvent, Done>
	readonly lastUserMessageId: Ref.Ref<Option.Option<MessageId>>
	readonly sequence: Ref.Ref<number>
	readonly pendingPermissions: Ref.Ref<
		HashMap.HashMap<string, Deferred.Deferred<CursorPermissionDecision>>
	>
	readonly providerSessionId: Ref.Ref<Option.Option<string>>
	readonly handle: CursorAcpHandle
}

type FileText = {
	readonly readFileString: (path: string) => Effect.Effect<string, PlatformError>
	readonly writeFileString: (
		path: string,
		content: string
	) => Effect.Effect<void, PlatformError>
}

type ProcessSpawner = {
	readonly spawn: (
		command: ChildProcess.Command
	) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle, PlatformError, Scope.Scope>
}

const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CURSOR_PROVIDER_ID,
		operation,
		detail
	})

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

const jsonFromValue = <A>(value: A): Option.Option<Json> => {
	const exit = decodeJson(value)
	if (Exit.isSuccess(exit)) {
		return Option.some(exit.value)
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

const offerOutbound = (runtime: SessionRuntime, event: OrchestrationEvent) =>
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

const makeMessageSent = Effect.fn("CursorAdapter.makeMessageSent")(function*(
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

const makeCancelled = Effect.fn("CursorAdapter.makeCancelled")(function*(runtime: SessionRuntime) {
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

const publishFact = Effect.fn("CursorAdapter.publishFact")(function*(
	runtime: SessionRuntime,
	fact: CursorContractFact
) {
	if (fact.contractKind === "text_delta") {
		const event = yield* makeTokenEvent(runtime, fact.token)
		return yield* offerOutbound(runtime, event)
	}
	const event = yield* makeMetaEvent(runtime, fact)
	return yield* offerOutbound(runtime, event)
})

const publishStopReason = Effect.fn("CursorAdapter.publishStopReason")(function*(
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

const requireSession = Effect.fn("CursorAdapter.requireSession")(function*(
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

const requireProviderSessionId = Effect.fn("CursorAdapter.requireProviderSessionId")(function*(
	runtime: SessionRuntime,
	operation: ProviderAdapterError["operation"]
) {
	const providerSessionId = yield* Ref.get(runtime.providerSessionId)
	if (Option.isNone(providerSessionId)) {
		return yield* adapterError(operation, "Cursor ACP session id is missing.")
	}
	return providerSessionId.value
})

const cancelledPermission: RequestPermissionResponse = {
	outcome: {
		outcome: "cancelled"
	}
}

const permissionResponse = (
	request: Json,
	decision: CursorPermissionDecision
): RequestPermissionResponse => {
	const optionId = selectPermissionOptionId(request, decision)
	if (Option.isNone(optionId)) {
		return cancelledPermission
	}
	return {
		outcome: {
			outcome: "selected",
			optionId: optionId.value
		}
	}
}

const handleSessionUpdate = (
	input: CursorConnectInput,
	params: SessionNotification
): Promise<void> =>
	Effect.runPromise(
		Option.match(jsonFromValue(params), {
			onNone: () => Effect.void,
			onSome: input.onSessionUpdate
		})
	)

const handlePermissionRequest = (
	input: CursorConnectInput,
	params: RequestPermissionRequest
): Promise<RequestPermissionResponse> =>
	Effect.runPromise(
		Effect.gen(function*() {
			const json = jsonFromValue(params)
			if (Option.isNone(json)) {
				return cancelledPermission
			}
			const decision = yield* input.onPermissionRequest(json.value)
			return permissionResponse(json.value, decision)
		})
	)

const handleReadTextFile = (
	fs: FileText,
	params: ReadTextFileRequest
): Promise<{ readonly content: string }> =>
	Effect.runPromise(
		fs.readFileString(params.path).pipe(
			Effect.map((content) => ({ content })),
			Effect.orElseSucceed(() => ({ content: "" }))
		)
	)

const handleWriteTextFile = (
	fs: FileText,
	params: WriteTextFileRequest
): Promise<WriteTextFileResponse> =>
	Effect.runPromise(fs.writeFileString(params.path, params.content).pipe(Effect.as({})))

const writableToQueue = (
	queue: Queue.Queue<Uint8Array, Done>
): WritableStream<Uint8Array> =>
	new WritableStream<Uint8Array>({
		write: (chunk) => Effect.runPromise(Queue.offer(queue, chunk).pipe(Effect.asVoid))
	})

const openAcpConnection = (
	input: CursorConnectInput,
	toAgent: Queue.Queue<Uint8Array, Done>,
	fromAgent: ReadableStream<Uint8Array>,
	fs: FileText
) => {
	const stream = ndJsonStream(writableToQueue(toAgent), fromAgent)
	return client({ name: "acepe" })
		.onNotification(methods.client.session.update, (ctx) => handleSessionUpdate(input, ctx.params))
		.onRequest(methods.client.session.requestPermission, (ctx) =>
			handlePermissionRequest(input, ctx.params)
		)
		.onRequest(methods.client.fs.readTextFile, (ctx) => handleReadTextFile(fs, ctx.params))
		.onRequest(methods.client.fs.writeTextFile, (ctx) => handleWriteTextFile(fs, ctx.params))
		.connect(stream)
}

const acpHandleFromConnection = (
	connection: ReturnType<typeof openAcpConnection>,
	closeResources: Effect.Effect<void>
): CursorAcpHandle => ({
	initialize: Effect.tryPromise({
		try: () =>
			connection.agent.request(methods.agent.initialize, {
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: {
						readTextFile: true,
						writeTextFile: true
					}
				},
				clientInfo: {
					name: "acepe",
					version: "0.0.1"
				}
			}),
		catch: (cause) => adapterError("startSession", errorDetail(cause, "Cursor ACP initialize failed"))
	}).pipe(Effect.asVoid),
	newSession: (cwd: string) =>
		Effect.tryPromise({
			try: () =>
				connection.agent.request(methods.agent.session.new, {
					cwd,
					mcpServers: []
				}),
			catch: (cause) => adapterError("startSession", errorDetail(cause, "Cursor session/new failed"))
		}).pipe(Effect.map((response) => response.sessionId)),
	prompt: (providerSessionId: string, text: string) =>
		Effect.tryPromise({
			try: () =>
				connection.agent.request(methods.agent.session.prompt, {
					sessionId: providerSessionId,
					prompt: [
						{
							type: "text",
							text
						}
					]
				}),
			catch: (cause) => adapterError("sendPrompt", errorDetail(cause, "Cursor session/prompt failed"))
		}).pipe(Effect.map((response) => Option.some(response.stopReason))),
	cancel: (providerSessionId: string) =>
		Effect.tryPromise({
			try: () =>
				connection.agent.notify(methods.agent.session.cancel, {
					sessionId: providerSessionId
				}),
			catch: (cause) => adapterError("cancelTurn", errorDetail(cause, "Cursor session/cancel failed"))
		}),
	close: Effect.sync(() => {
		connection.close()
	}).pipe(Effect.flatMap(() => closeResources))
})

const liveConnect = Effect.fn("CursorAdapter.liveConnect")(function*(input: {
	readonly session: CursorConnectInput
	readonly fs: FileText
	readonly spawner: ProcessSpawner
}) {
	const sessionScope = yield* Scope.make()
	const toAgent = yield* Queue.unbounded<Uint8Array, Done>()
	const child = yield* input.spawner
		.spawn(
			ChildProcess.make(input.session.launch.command, Arr.fromIterable(input.session.launch.args), {
				extendEnv: true,
				detached: false
			})
		)
		.pipe(
			Effect.provideService(Scope.Scope, sessionScope),
			Effect.mapError((error) => adapterError("startSession", error.message))
		)
	yield* Stream.fromQueue(toAgent).pipe(
		Stream.run(child.stdin),
		Effect.forkIn(sessionScope, { startImmediately: true })
	)
	yield* child.stderr.pipe(Stream.runDrain, Effect.forkIn(sessionScope, { startImmediately: true }))
	const fromAgent = yield* Stream.toReadableStreamEffect(child.stdout)
	const connection = openAcpConnection(input.session, toAgent, fromAgent, input.fs)
	const closeResources = Queue.end(toAgent).pipe(
		Effect.flatMap(() => Scope.close(sessionScope, Exit.void)),
		Effect.asVoid
	)
	return acpHandleFromConnection(connection, closeResources)
})

const resolveLaunchFromInstaller = (installer: AgentInstallerShape) =>
	Effect.gen(function*() {
		const cached = yield* installer.getCached(CURSOR_PROVIDER_ID).pipe(
			Effect.mapError((error) => adapterError("startSession", error.message))
		)
		if (Option.isNone(cached)) {
			return yield* adapterError(
				"startSession",
				"Cursor agent is not installed from the ACP registry."
			)
		}
		return {
			command: cached.value.binaryPath,
			args: cached.value.args
		}
	})

export const makeCursorAdapter = Effect.fn("makeCursorAdapter")(function*(
	options: CursorAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const publishSessionUpdate = Effect.fn("CursorAdapter.publishSessionUpdate")(function*(
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

	const decidePermission = Effect.fn("CursorAdapter.decidePermission")(function*(
		runtimeHolder: Ref.Ref<Option.Option<SessionRuntime>>,
		request: Json
	) {
		const held = yield* Ref.get(runtimeHolder)
		if (Option.isNone(held)) {
			return "deny" as const
		}
		const fact = mapAcpPermissionRequest(request)
		if (Option.isNone(fact)) {
			return "deny" as const
		}
		const deferred = yield* Deferred.make<CursorPermissionDecision>()
		yield* Ref.update(held.value.pendingPermissions, (current) =>
			HashMap.set(current, fact.value.id, deferred)
		)
		yield* publishFact(held.value, fact.value)
		return yield* Deferred.await(deferred)
	})

	const openSession = Effect.fn("CursorAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Cursor session '${request.sessionId}' is already open.`
			)
		}
		const launch = yield* options.resolveLaunch
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		const pendingPermissions = yield* Ref.make(
			HashMap.empty<string, Deferred.Deferred<CursorPermissionDecision>>()
		)
		const providerSessionId = yield* Ref.make(Option.none<string>())
		const runtimeHolder = yield* Ref.make(Option.none<SessionRuntime>())
		const handle = yield* options.connect({
			launch,
			onSessionUpdate: (notification) => publishSessionUpdate(runtimeHolder, notification),
			onPermissionRequest: (permission) => decidePermission(runtimeHolder, permission)
		})
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			outbound,
			lastUserMessageId,
			sequence,
			pendingPermissions,
			providerSessionId,
			handle
		}
		yield* Ref.set(runtimeHolder, Option.some(runtime))
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		yield* handle.initialize
		const openedId = yield* handle.newSession(request.workspaceRoot)
		yield* Ref.set(providerSessionId, Option.some(openedId))
		yield* publishFact(runtime, providerSessionFact(openedId))
		return runtime
	})

	const startSession = (request: StartSessionRequest) =>
		Stream.unwrap(
			Effect.gen(function*() {
				const runtime = yield* openSession(request)
				return Stream.fromQueue(runtime.outbound)
			})
		)

	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				const acpSessionId = yield* requireProviderSessionId(runtime, "sendPrompt")
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				const sent = yield* makeMessageSent(runtime, request)
				yield* runtime.handle.prompt(acpSessionId, request.text).pipe(
					Effect.flatMap((stop) =>
						Option.match(stop, {
							onNone: () => Effect.void,
							onSome: (reason) => publishStopReason(runtime, reason)
						})
					),
					Effect.catchTag("ProviderAdapterError", (error) =>
						publishFact(runtime, {
							contractKind: "turn_error",
							detail: Str.isNonEmpty(error.detail) ? error.detail : "Cursor session/prompt failed"
						})
					),
					Effect.forkChild({ startImmediately: true })
				)
				return sent
			})
		)

	const cancelTurn = Effect.fn("CursorAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const acpSessionId = yield* requireProviderSessionId(runtime, "cancelTurn")
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
		yield* runtime.handle.cancel(acpSessionId).pipe(Effect.ignore)
		yield* Queue.end(runtime.outbound).pipe(Effect.asVoid)
		yield* runtime.handle.close
		yield* Ref.update(sessions, (current) => HashMap.remove(current, request.sessionId))
	})

	const respondToPermission = Effect.fn("CursorAdapter.respondToPermission")(function*(input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: CursorPermissionDecision
	}) {
		const runtime = yield* requireSession(sessions, input.sessionId, "sendPrompt")
		const pending = yield* Ref.get(runtime.pendingPermissions)
		const deferred = HashMap.get(pending, input.permissionId)
		if (Option.isNone(deferred)) {
			return yield* adapterError("sendPrompt", `No permission request '${input.permissionId}'.`)
		}
		yield* Deferred.succeed(deferred.value, input.decision)
		yield* Ref.update(runtime.pendingPermissions, (current) =>
			HashMap.remove(current, input.permissionId)
		)
	})

	return {
		providerId: CURSOR_PROVIDER_ID,
		capabilities: CURSOR_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission
	} satisfies CursorAdapter
})

export const makeLiveCursorAdapter = Effect.fn("makeLiveCursorAdapter")(function*() {
	const installer = yield* AgentInstaller
	const fs = yield* FileSystem.FileSystem
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const cached = yield* installer.getCached(CURSOR_PROVIDER_ID)
	const authenticated = yield* probeCursorAuthenticated()
	return yield* makeCursorAdapter({
		presence: Effect.succeed(cursorPresence(Option.isSome(cached), authenticated)),
		resolveLaunch: resolveLaunchFromInstaller(installer),
		connect: (input) =>
			liveConnect({
				session: input,
				fs,
				spawner
			})
	})
})
