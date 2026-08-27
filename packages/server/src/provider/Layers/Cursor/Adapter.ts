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
import type { OpenToolCallInfo } from "../SessionEvents.ts"
import { providerSessionFact } from "./Facts.ts"
import {
	type CursorRespondToPermissionInput,
	decidePermission,
	drainPendingPermissions,
	respondToPermission
} from "./Permissions.ts"
import {
	type CursorAcpHandle,
	type CursorConnectInput,
	type CursorLaunchConfig,
	liveConnect
} from "./Process.ts"
import {
	adapterError,
	CURSOR_CAPABILITIES,
	CURSOR_PROVIDER_ID,
	cursorLaunchConfig,
	cursorPresence,
	type CursorPermissionDecision,
	missingCursorBinaryError,
	probeCursorAuthenticated,
	probeCursorBinary
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

export const CURSOR_ACP_SDK_MODULE = "@agentclientprotocol/sdk"
export const CURSOR_ACP_PROTOCOL_VERSION = PROTOCOL_VERSION

export type CursorAdapter = ProviderAdapter & {
	// ACP's session/set_mode, reached through the same connection every
	// other Cursor call uses — see setMode in Process.ts.
	readonly setMode: (request: SetModeRequest) => Effect.Effect<void, ProviderAdapterError>
	readonly respondToPermission: (
		input: CursorRespondToPermissionInput
	) => Effect.Effect<void, ProviderAdapterError>
	// Closes every live session's ACP connection and reaps its spawned
	// `cursor-agent` subprocess. ProviderBridge calls this structurally, the
	// same way it calls respondToPermission, on every registered adapter
	// that exposes it when the bridge's own scope closes.
	readonly shutdown: Effect.Effect<void>
}

export type CursorAdapterOptions = {
	readonly presence: Effect.Effect<ProviderPresence>
	readonly resolveLaunch: Effect.Effect<CursorLaunchConfig, ProviderAdapterError>
	readonly connect: (
		input: CursorConnectInput
	) => Effect.Effect<CursorAcpHandle, ProviderAdapterError>
}

export const makeCursorAdapter = Effect.fn("makeCursorAdapter")(function*(
	options: CursorAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

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
		const openToolCalls = yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>())
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
			openToolCalls,
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

	const setMode = Effect.fn("CursorAdapter.setMode")(function*(request: SetModeRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "setMode")
		const acpSessionId = yield* requireProviderSessionId(runtime, "setMode")
		yield* runtime.handle.setMode(acpSessionId, request.modeId)
	})

	const cancelTurn = Effect.fn("CursorAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
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
	// `cursor-agent` subprocess on app/layer shutdown, not just on an
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
	}).pipe(Effect.withSpan("CursorAdapter.shutdown"))

	return {
		providerId: CURSOR_PROVIDER_ID,
		capabilities: CURSOR_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		setMode,
		respondToPermission: (input: CursorRespondToPermissionInput) =>
			respondToPermission(sessions, input),
		shutdown
	} satisfies CursorAdapter
})

// Cursor's only launch path used to read AgentInstaller, a service nothing
// builds — it needs a PlatformKey the codebase does not detect — so the
// adapter could not be registered and Cursor was unreachable even for an
// operator who had the CLI installed. It now resolves `cursor-agent` off
// PATH, the same detection every other live adapter uses, which is what lets
// bootstrap.ts register it.
export const makeLiveCursorAdapter = Effect.fn("makeLiveCursorAdapter")(function*() {
	const fs = yield* FileSystem.FileSystem
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const binary = yield* probeCursorBinary()
	const authenticated = yield* probeCursorAuthenticated()
	return yield* makeCursorAdapter({
		presence: Effect.succeed(cursorPresence(Option.isSome(binary), authenticated)),
		resolveLaunch: Option.match(binary, {
			onNone: (): Effect.Effect<CursorLaunchConfig, ProviderAdapterError> =>
				Effect.fail(missingCursorBinaryError()),
			onSome: (command) => Effect.succeed(cursorLaunchConfig(command))
		}),
		connect: (input) =>
			liveConnect({
				session: input,
				fs,
				spawner
			})
	})
})
