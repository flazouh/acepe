import {
	MessageId,
	type OrchestrationEvent,
	SessionId
} from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as Arr from "effect/Array"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	type ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type StartSessionRequest
} from "../../Services/ProviderAdapter.ts"
import type { Json } from "../Json.ts"
import { providerSessionFact } from "./Facts.ts"
import { emptyCodexMapState } from "./Map.ts"
import { respondToPermission, respondToQuestion } from "./Permissions.ts"
import {
	type CodexAppServerHandle,
	type CodexJsonRpcRequest,
	errorDetail,
	failPending,
	handleStdoutLine,
	type PendingRequest,
	writeJsonLine
} from "./Process.ts"
import {
	adapterError,
	CODEX_CAPABILITIES,
	CODEX_PROVIDER_ID,
	CODEX_REQUEST_TIMEOUT_SECONDS,
	type CodexNativeConfigState,
	defaultCodexNativeConfigState,
	probeCodexPresence,
	resolveCodexSpawnConfig
} from "./Provider.ts"
import {
	makeCancelled,
	makeMessageSent,
	makeMetaEvent,
	offerOutbound,
	type OpenToolCallInfo,
	publishServerMessage,
	requireSession,
	type SessionRuntime
} from "./Session.ts"
import {
	buildCodexInitializeParams,
	buildCodexTurnStartParams,
	buildThreadStartParams,
	buildTurnInterruptParams,
	parseThreadId,
	parseTurnId
} from "./Wire.ts"

export type CodexAppServerInput = {
	readonly cwd: string
	readonly command: string
	readonly args: ReadonlyArray<string>
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
			replyIds: yield* Ref.make(HashMap.empty<string, Json>()),
			openToolCalls: yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>()),
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

	return {
		providerId: CODEX_PROVIDER_ID,
		capabilities: CODEX_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission: (input) => respondToPermission(sessions, input),
		respondToQuestion: (input) => respondToQuestion(sessions, input)
	} satisfies CodexAdapter
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
