/**
 * Grok Build ACP adapter. Official ACP session/update JSON becomes CONTRACT events.
 *
 * Grok-specific handshake: initialize, then authenticate (cached_token or
 * xai.api_key with _meta.headless), then session/new. Acepe never stores the
 * token. Import/resume of ~/.grok/sessions/ is out of scope.
 */
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import type { MessageId, OrchestrationEvent, SessionId } from "@acepe/contracts"
import type { Done } from "effect/Cause"
import type * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type {
	CancelTurnRequest,
	ProviderAdapter,
	ProviderAdapterError,
	ProviderPresence,
	SendPromptRequest,
	SetModeRequest,
	StartSessionRequest
} from "../../Services/ProviderAdapter.ts"
import { bindPresence, bindProbe } from "../ExecutableProbe.ts"
import type { OpenToolCallInfo } from "../SessionEvents.ts"
import { providerSessionFact } from "./Facts.ts"
import {
	type GrokRespondToPermissionInput,
	decidePermission,
	drainPendingPermissions,
	respondToPermission
} from "./Permissions.ts"
import {
	type GrokAcpHandle,
	type GrokConnectInput,
	type GrokLaunchConfig,
	liveConnect
} from "./Process.ts"
import {
	adapterError,
	GROK_CAPABILITIES,
	GROK_PROVIDER_ID,
	type GrokAuthenticateParams,
	grokLaunchConfig,
	type GrokPermissionDecision,
	missingGrokBinaryError,
	probeGrokAuthenticateParams,
	probeGrokBinary,
	probeGrokPresence
} from "./Provider.ts"
import {
	makeCancelled,
	makeMessageSent,
	offerOutbound,
	publishFact,
	publishSessionUpdate,
	publishStopReason,
	requireProviderSessionId,
	requireSession,
	type SessionRuntime
} from "./Session.ts"

export const GROK_ACP_SDK_MODULE = "@agentclientprotocol/sdk"
export const GROK_ACP_PROTOCOL_VERSION = PROTOCOL_VERSION

export type GrokAdapter = ProviderAdapter & {
	// ACP's session/set_mode, reached through the same connection every
	// other Grok call uses — see setMode in Process.ts.
	readonly setMode: (request: SetModeRequest) => Effect.Effect<void, ProviderAdapterError>
	readonly respondToPermission: (
		input: GrokRespondToPermissionInput
	) => Effect.Effect<void, ProviderAdapterError>
	// Closes every live session's ACP connection and reaps its spawned
	// `grok` subprocess. ProviderBridge calls this structurally, the
	// same way it calls respondToPermission, on every registered adapter
	// that exposes it when the bridge's own scope closes.
	readonly shutdown: Effect.Effect<void>
}

export type GrokAdapterOptions = {
	readonly presence: Effect.Effect<ProviderPresence>
	readonly resolveLaunch: Effect.Effect<GrokLaunchConfig, ProviderAdapterError>
	readonly resolveAuthenticate: Effect.Effect<GrokAuthenticateParams, ProviderAdapterError>
	readonly connect: (
		input: GrokConnectInput
	) => Effect.Effect<GrokAcpHandle, ProviderAdapterError>
}

export const makeGrokAdapter = Effect.fn("makeGrokAdapter")(function*(
	options: GrokAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const openSession = Effect.fn("GrokAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Grok session '${request.sessionId}' is already open.`
			)
		}
		const launch = yield* options.resolveLaunch
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		const pendingPermissions = yield* Ref.make(
			HashMap.empty<string, Deferred.Deferred<GrokPermissionDecision>>()
		)
		const openToolCalls = yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>())
		const providerSessionId = yield* Ref.make(Option.none<string>())
		const runtimeHolder = yield* Ref.make(Option.none<SessionRuntime>())
		const handle = yield* options.connect({
			launch,
			envOverrides: request.envOverrides,
			onSessionUpdate: (notification) => publishSessionUpdate(runtimeHolder, notification),
			onPermissionRequest: (permission) => decidePermission(runtimeHolder, permission)
		})
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			outbound,
			lastUserMessageId,
			sequence,
			pendingPermissions,
			openToolCalls,
			providerSessionId,
			handle
		}
		yield* Ref.set(runtimeHolder, Option.some(runtime))
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		yield* handle.initialize
		const authenticate = yield* options.resolveAuthenticate
		yield* handle.authenticate(authenticate)
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
							detail: Str.isNonEmpty(error.detail) ? error.detail : "Grok session/prompt failed"
						})
					),
					Effect.forkChild({ startImmediately: true })
				)
				return sent
			})
		)

	const setMode = Effect.fn("GrokAdapter.setMode")(function*(request: SetModeRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "setMode")
		const acpSessionId = yield* requireProviderSessionId(runtime, "setMode")
		yield* runtime.handle.setMode(acpSessionId, request.modeId)
	})

	const cancelTurn = Effect.fn("GrokAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const acpSessionId = yield* requireProviderSessionId(runtime, "cancelTurn")
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
		yield* runtime.handle.cancel(acpSessionId).pipe(Effect.ignore)
		yield* runtime.handle.close
		// Drained AFTER the handle is closed, not before it: the agent can
		// still raise a session/request_permission while session/cancel is
		// in flight, and a permission asked inside that window would survive
		// an earlier drain with nobody left to answer it — this session is
		// about to leave `sessions` entirely, so respondToPermission could
		// not reach it either. Closing the handle first is what makes this
		// the last possible moment a new one can arrive. Still ahead of
		// Queue.end below, because the drain publishes onto outbound. See
		// drainPendingPermissions.
		yield* drainPendingPermissions(runtime)
		yield* Queue.end(runtime.outbound).pipe(Effect.asVoid)
		yield* Ref.update(sessions, (current) => HashMap.remove(current, request.sessionId))
	})

	// Tears down every live session's ACP connection and spawned
	// `grok` subprocess on app/layer shutdown, not just on an
	// explicit cancel — ProviderBridge.ts calls this structurally on every
	// registered adapter that exposes it (see supportsShutdown there).
	// Without it, quitting the app left both the subprocess and every
	// pending ACP permission behind.
	const shutdown = Effect.gen(function*() {
		const current = yield* Ref.getAndSet(sessions, HashMap.empty<SessionId, SessionRuntime>())
		yield* Effect.forEach(
			HashMap.values(current),
			(runtime) =>
				runtime.handle.close.pipe(
					// Same order as cancelTurn's, for the same reason.
					Effect.andThen(drainPendingPermissions(runtime)),
					Effect.andThen(Queue.end(runtime.outbound)),
					Effect.asVoid
				),
			{ discard: true, concurrency: "unbounded" }
		)
	}).pipe(Effect.withSpan("GrokAdapter.shutdown"))

	return {
		providerId: GROK_PROVIDER_ID,
		capabilities: GROK_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		setMode,
		respondToPermission: (input: GrokRespondToPermissionInput) =>
			respondToPermission(sessions, input),
		shutdown
	} satisfies GrokAdapter
})

export const makeLiveGrokAdapter = Effect.fn("makeLiveGrokAdapter")(function*() {
	const fs = yield* FileSystem.FileSystem
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	return yield* makeGrokAdapter({
		// The probe, not its answer -- see ExecutableProbe.ts's bindProbe.
		presence: yield* bindPresence(probeGrokPresence()),
		// Resolved per session, not once at construction: an agent installed
		// after the layer was built must be launchable without a restart.
		resolveLaunch: yield* bindProbe(
			probeGrokBinary().pipe(
				Effect.flatMap(
					Option.match({
						onNone: (): Effect.Effect<GrokLaunchConfig, ProviderAdapterError> =>
							Effect.fail(missingGrokBinaryError()),
						onSome: (command) => Effect.succeed(grokLaunchConfig(command))
					})
				)
			)
		),
		resolveAuthenticate: yield* bindProbe(probeGrokAuthenticateParams()),
		connect: (input) =>
			liveConnect({
				session: input,
				fs,
				spawner
			})
	})
})
