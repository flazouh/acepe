import { MessageId, type OrchestrationEvent, SessionId } from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	type ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type StartSessionRequest
} from "../../Services/ProviderAdapter.ts"
import {
	type OpenCodePermissionReply,
	providerSessionFact,
	sessionCatalogFact
} from "./Facts.ts"
import { emptyOpenCodeStreamState } from "./Map.ts"
import { respondToPermission, respondToQuestion } from "./Permissions.ts"
import { liveCreateTransport, type OpenCodeTransport } from "./Process.ts"
import {
	adapterError,
	OPENCODE_ALLOWED_ENV_KEYS,
	OPENCODE_CAPABILITIES,
	OPENCODE_DEFAULT_MODE,
	OPENCODE_ISOLATED_CONFIG_ENV_KEY,
	OPENCODE_PLACEHOLDER_BINARY,
	OPENCODE_PROVIDER_ID,
	openCodeServeArgs,
	probeOpenCodeBinary,
	probeOpenCodePresence,
	resolveOpenCodeIsolatedConfigDir
} from "./Provider.ts"
import {
	makeCancelled,
	makeMessageSent,
	makeMetaEvent,
	offerOutbound,
	type OpenToolCallInfo,
	publishSse,
	requireProviderSession,
	requireSession,
	type SessionRuntime
} from "./Session.ts"
import { buildPromptBody, parseModelSelection } from "./Wire.ts"

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
		const openToolCalls = yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>())
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			workspaceRoot: request.workspaceRoot,
			outbound,
			streamState,
			lastUserMessageId,
			sequence,
			openToolCalls,
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

	return {
		providerId: OPENCODE_PROVIDER_ID,
		capabilities: OPENCODE_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission: (input) => respondToPermission(sessions, input),
		respondToQuestion: (input) => respondToQuestion(sessions, input)
	} satisfies OpenCodeAdapter
})

export const makeLiveOpenCodeAdapter = Effect.fn("makeLiveOpenCodeAdapter")(function*() {
	const presenceValue = yield* probeOpenCodePresence()
	const binary = yield* probeOpenCodeBinary()
	const command = Option.getOrElse(binary, () => OPENCODE_PLACEHOLDER_BINARY)
	const http = yield* HttpClient.HttpClient
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const path = yield* Path.Path
	const envPairs = yield* Effect.forEach(OPENCODE_ALLOWED_ENV_KEYS, (key) =>
		Config.option(Config.string(key)).pipe(
			Effect.map((value) => Option.map(value, (text) => [key, text] as const))
		)
	)
	// Isolation: override XDG_CONFIG_HOME so the spawned `opencode serve`
	// resolves its global config to an app-owned, empty-by-default directory
	// instead of the operator's ~/.config/opencode (which carries personal
	// MCP servers, agents, and plugins) — see OPENCODE_ISOLATED_CONFIG_ENV_KEY
	// in Provider.ts for the empirical evidence. TMPDIR falls back to
	// "/tmp" when unset, matching the POSIX default.
	const tmpDir = yield* Config.option(Config.string("TMPDIR")).pipe(
		Effect.map((value) => Option.getOrElse(value, () => "/tmp"))
	)
	const env = {
		...Object.fromEntries(Arr.getSomes(envPairs)),
		[OPENCODE_ISOLATED_CONFIG_ENV_KEY]: resolveOpenCodeIsolatedConfigDir(path, tmpDir)
	}
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
