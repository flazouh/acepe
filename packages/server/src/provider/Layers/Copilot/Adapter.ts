/**
 * GitHub Copilot ACP adapter. The CLI's `copilot --acp --stdio` JSON-RPC
 * stream becomes CONTRACT events.
 *
 * Known gaps, each one a documented absence rather than a silent one:
 * - no ACP fs/read_text_file or fs/write_text_file handler, so
 *   copilotInitializeParams advertises both capabilities as off
 * - no history reconnect / provider-owned session snapshot
 * - no model discovery: COPILOT_CAPABILITIES claims "models" but nothing
 *   lists them yet
 */
import { type MessageId, type OrchestrationEvent, SessionId, TurnId } from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	type ProviderAdapterError,
	type ProviderAdapter,
	type ProviderPresence,
	type CancelTurnRequest,
	type SendPromptRequest,
	type SetModeRequest,
	type StartSessionRequest
} from "../../Services/ProviderAdapter.ts"
import type { Json } from "../Json.ts"
import type { OpenToolCallInfo } from "../SessionEvents.ts"
import { providerSessionFact } from "./Facts.ts"
import { mapPromptResult } from "./Map.ts"
import {
	type CopilotRespondToPermissionInput,
	drainPendingPermissions,
	respondToPermission
} from "./Permissions.ts"
import { type CopilotAcpHandle, liveCreateTransport } from "./Process.ts"
import {
	adapterError,
	COPILOT_CAPABILITIES,
	COPILOT_PROVIDER_ID,
	copilotLaunchConfig,
	missingCopilotBinaryError,
	probeCopilotBinary,
	probeCopilotPresence
} from "./Provider.ts"
import {
	makeCancelled,
	makeMessageSent,
	makeMetaEvent,
	offerOutbound,
	type PendingPermission,
	publishAcpMessage,
	publishFact,
	requireProviderSessionId,
	requireSession,
	type SessionRuntime
} from "./Session.ts"
import {
	beginCopilotPrompt,
	cancelCopilotTurn,
	completeCopilotPrompt,
	emptyCopilotTurnState
} from "./TurnTracking.ts"
import {
	copilotCancelParams,
	copilotInitializeParams,
	copilotPromptParams,
	copilotSessionNewParams,
	copilotSessionNewResultId,
	copilotSetModeParams,
	INITIALIZE_METHOD,
	SESSION_CANCEL_METHOD,
	SESSION_NEW_METHOD,
	SESSION_PROMPT_METHOD,
	SESSION_SET_MODE_METHOD
} from "./Wire.ts"

export type CopilotAdapter = ProviderAdapter & {
	// ACP's session/set_mode over the same JSON-RPC transport session/prompt
	// uses — see copilotSetModeParams in Wire.ts for the mode-URI form
	// Copilot expects.
	readonly setMode: (request: SetModeRequest) => Effect.Effect<void, ProviderAdapterError>
	readonly respondToPermission: (
		input: CopilotRespondToPermissionInput
	) => Effect.Effect<void, ProviderAdapterError>
	// Closes every live session's transport and reaps its spawned `copilot`
	// subprocess. ProviderBridge calls this structurally on every registered
	// adapter that exposes it when the bridge's own scope closes.
	readonly shutdown: Effect.Effect<void>
}

export type CopilotAdapterOptions = {
	readonly createTransport: (
		input: { readonly cwd: string }
	) => Effect.Effect<CopilotAcpHandle, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
}

export const makeCopilotAdapter = Effect.fn("makeCopilotAdapter")(function*(
	options: CopilotAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())

	const settlePrompt = Effect.fn("CopilotAdapter.settlePrompt")(function*(
		runtime: SessionRuntime,
		seq: number,
		result: Json
	) {
		const terminal = mapPromptResult(result)
		const stopReason = terminal.contractKind === "turn_error" ? terminal.detail : "end_turn"
		const settled = yield* Ref.modify(runtime.turnState, (state) => {
			const next = completeCopilotPrompt(state, seq, stopReason)
			return [next, next.state] as const
		})
		if (settled.emitComplete) {
			yield* publishFact(runtime, terminal)
		}
	})

	const openSession = Effect.fn("CopilotAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Copilot session '${request.sessionId}' is already open.`
			)
		}
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		const turnState = yield* Ref.make(emptyCopilotTurnState)
		const openToolCalls = yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>())
		const pendingPermissions = yield* Ref.make(HashMap.empty<string, PendingPermission>())
		const providerSessionId = yield* Ref.make(Option.none<string>())
		const transport = yield* options.createTransport({ cwd: request.workspaceRoot })
		// ACP's opening handshake, before anything else: Copilot answers a
		// session/new that arrives first with a protocol error, and the
		// session then looks like a transport fault rather than a missing
		// handshake.
		yield* transport.request(INITIALIZE_METHOD, copilotInitializeParams())
		const created = yield* transport.request(
			SESSION_NEW_METHOD,
			copilotSessionNewParams(request.workspaceRoot)
		)
		const acpSessionId = copilotSessionNewResultId(created)
		if (Option.isNone(acpSessionId)) {
			return yield* adapterError("startSession", "Copilot session/new did not return a session id.")
		}
		yield* Ref.set(providerSessionId, acpSessionId)
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			providerSessionId,
			outbound,
			lastUserMessageId,
			sequence,
			turnState,
			openToolCalls,
			pendingPermissions,
			transport
		}
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, request.sessionId)
		)
		yield* transport.notifications.pipe(
			Stream.runForEach((raw) => publishAcpMessage(runtime, raw)),
			Effect.ensuring(
				// Drained before the queue ends, because the drain publishes an
				// answer onto outbound for every approval the closing
				// connection abandons — see drainPendingPermissions.
				drainPendingPermissions(runtime).pipe(
					Effect.andThen(Queue.end(runtime.outbound)),
					Effect.andThen(dropSession),
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
				const providerId = yield* Ref.get(runtime.providerSessionId)
				const opened = yield* makeMetaEvent(
					runtime,
					providerSessionFact(Option.getOrElse(providerId, () => request.sessionId))
				)
				return Stream.concat(Stream.make(opened), Stream.fromQueue(runtime.outbound))
			})
		)

	const transportPrompt = (
		runtime: SessionRuntime,
		providerSessionId: string,
		text: string,
		seq: number
	) =>
		runtime.transport
			.request(SESSION_PROMPT_METHOD, copilotPromptParams(providerSessionId, text))
			.pipe(
				Effect.flatMap((result) => settlePrompt(runtime, seq, result)),
				Effect.ignore,
				Effect.forkChild({ startImmediately: true })
			)

	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				const acpSessionId = yield* requireProviderSessionId(runtime, "sendPrompt")
				const begun = yield* Ref.modify(runtime.turnState, (state) => {
					const next = beginCopilotPrompt(
						state,
						TurnId.make(`${runtime.sessionId}:turn:${state.promptSequence + 1}`)
					)
					return [next, next.state] as const
				})
				yield* transportPrompt(runtime, acpSessionId, request.text, begun.seq)
				return yield* makeMessageSent(runtime, request)
			})
		)

	const setMode = Effect.fn("CopilotAdapter.setMode")(function*(request: SetModeRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "setMode")
		const acpSessionId = yield* requireProviderSessionId(runtime, "setMode")
		yield* runtime.transport.request(
			SESSION_SET_MODE_METHOD,
			copilotSetModeParams(acpSessionId, request.modeId)
		)
	})

	const cancelTurn = Effect.fn("CopilotAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const acpSessionId = yield* Ref.get(runtime.providerSessionId)
		if (Option.isSome(acpSessionId)) {
			yield* runtime.transport
				.notify(SESSION_CANCEL_METHOD, copilotCancelParams(acpSessionId.value))
				.pipe(Effect.ignore)
		}
		yield* Ref.set(runtime.turnState, cancelCopilotTurn(yield* Ref.get(runtime.turnState)))
		// Answered here rather than only when the notification stream ends: the
		// agent blocks on the reply, so a cancelled turn that leaves a
		// permission unanswered keeps the CLI waiting for an answer that is
		// never coming.
		yield* drainPendingPermissions(runtime)
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
	})

	// Tears down every live session's transport and spawned `copilot`
	// subprocess on app/layer shutdown, not just on an explicit cancel —
	// ProviderBridge.ts calls this structurally on every registered adapter
	// that exposes it (see supportsShutdown there).
	const shutdown = Effect.gen(function*() {
		const current = yield* Ref.getAndSet(sessions, HashMap.empty<SessionId, SessionRuntime>())
		yield* Effect.forEach(
			HashMap.values(current),
			(runtime) =>
				drainPendingPermissions(runtime).pipe(
					Effect.andThen(runtime.transport.close),
					Effect.andThen(Queue.end(runtime.outbound)),
					Effect.asVoid
				),
			{ discard: true, concurrency: "unbounded" }
		)
	}).pipe(Effect.withSpan("CopilotAdapter.shutdown"))

	return {
		providerId: COPILOT_PROVIDER_ID,
		capabilities: COPILOT_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		setMode,
		respondToPermission: (input: CopilotRespondToPermissionInput) =>
			respondToPermission(sessions, input),
		shutdown
	} satisfies CopilotAdapter
})

// Same shape as makeLiveOpenCodeAdapter: probe the binary once here, and let
// every session share the resolved path. An absent CLI is not a construction
// error — presence reports installed: false, the provider stays visible as
// not installed, and only an attempt to open a session fails, with a message
// that names the missing binary.
export const makeLiveCopilotAdapter = Effect.fn("makeLiveCopilotAdapter")(function*() {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	// The adapter outlives any one session, so the spawned CLI belongs to the
	// layer's scope, not to the scope of the session that first started it.
	const layerScope = yield* Effect.scope
	const presenceValue = yield* probeCopilotPresence()
	const binary = yield* probeCopilotBinary()
	return yield* makeCopilotAdapter({
		presence: Effect.succeed(presenceValue),
		createTransport: (input) =>
			Option.match(binary, {
				onNone: (): Effect.Effect<CopilotAcpHandle, ProviderAdapterError> =>
					Effect.fail(missingCopilotBinaryError()),
				onSome: (command) =>
					liveCreateTransport({
						cwd: input.cwd,
						launch: copilotLaunchConfig(command),
						spawner,
						scope: layerScope
					})
			})
	})
})

export type { CopilotAcpHandle, CopilotAcpRequest } from "./Process.ts"
