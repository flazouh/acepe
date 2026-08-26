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
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import type { PlatformError } from "effect/PlatformError"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { AgentInstallerShape } from "../../Services/AgentInstaller.ts"
import type { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import type { Json } from "../Json.ts"
import { cancelledPermission, permissionResponse } from "./Permissions.ts"
import {
	adapterError,
	CURSOR_PROVIDER_ID,
	type CursorPermissionDecision
} from "./Provider.ts"

const decodeJson = Schema.decodeUnknownExit(Schema.Json)

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

export type FileText = {
	readonly readFileString: (path: string) => Effect.Effect<string, PlatformError>
	readonly writeFileString: (
		path: string,
		content: string
	) => Effect.Effect<void, PlatformError>
}

export type ProcessSpawner = {
	readonly spawn: (
		command: ChildProcess.Command
	) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle, PlatformError, Scope.Scope>
}

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

export const liveConnect = Effect.fn("CursorAdapter.liveConnect")(function*(input: {
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

export const resolveLaunchFromInstaller = (installer: AgentInstallerShape) =>
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
