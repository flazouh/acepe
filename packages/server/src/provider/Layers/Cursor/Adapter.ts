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
import { AgentInstaller } from "../../Services/AgentInstaller.ts"
import type {
	CancelTurnRequest,
	ProviderAdapter,
	ProviderAdapterError,
	ProviderPresence,
	SendPromptRequest,
	StartSessionRequest
} from "../../Services/ProviderAdapter.ts"
import { providerSessionFact } from "./Facts.ts"
import {
	type CursorRespondToPermissionInput,
	decidePermission,
	respondToPermission
} from "./Permissions.ts"
import {
	type CursorAcpHandle,
	type CursorConnectInput,
	type CursorLaunchConfig,
	liveConnect,
	resolveLaunchFromInstaller
} from "./Process.ts"
import {
	adapterError,
	CURSOR_CAPABILITIES,
	CURSOR_PROVIDER_ID,
	cursorPresence,
	type CursorPermissionDecision,
	probeCursorAuthenticated
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
	readonly respondToPermission: (
		input: CursorRespondToPermissionInput
	) => Effect.Effect<void, ProviderAdapterError>
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

	return {
		providerId: CURSOR_PROVIDER_ID,
		capabilities: CURSOR_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission: (input: CursorRespondToPermissionInput) =>
			respondToPermission(sessions, input)
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
