import { MessageId, SessionId, type OrchestrationEvent } from "@acepe/contracts"
import type { Done } from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type {
	CancelTurnRequest,
	ProviderAdapter,
	ProviderAdapterError,
	ProviderPresence,
	SendPromptRequest,
	StartSessionRequest
} from "../../Services/ProviderAdapter.ts"
import type { OpenToolCallInfo } from "../SessionEvents.ts"
import { deferredOpenFact, type ClaudePermissionDecision } from "./Facts.ts"
import { emptyClaudeStreamState } from "./Map.ts"
import {
	bindCanUseTool,
	decidePermission,
	drainPendingPermissions,
	makeRespondToPermission
} from "./Permissions.ts"
import {
	makeLiveCreateQuery,
	teardownQuery,
	type ClaudeQueryHandle,
	type ClaudeQueryInput
} from "./Process.ts"
import {
	adapterError,
	CLAUDE_CAPABILITIES,
	CLAUDE_PROVIDER_ID,
	CLAUDE_SESSION_MCP_SERVERS,
	probeClaudePresence,
	resolveClaudeExecutablePath
} from "./Provider.ts"
import {
	makeCancelled,
	makeMessageSent,
	makeMetaEvent,
	offerOutbound,
	publishSdkMessage,
	requireSession,
	type SessionRuntime
} from "./Session.ts"
import { makeWatchdogLoop } from "./Watchdog.ts"
import { userPrompt, type ClaudeUserPrompt } from "./Wire.ts"

export type ClaudeAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: ClaudePermissionDecision
	}) => Effect.Effect<void, ProviderAdapterError>
	// Forcefully tears down every live session's query (SIGTERM-then-SIGKILL-
	// equivalent — see makeClaudeAdapter's shutdown). ProviderBridge calls
	// this structurally, the same way it calls respondToPermission, on every
	// registered adapter that exposes it when the bridge's own scope closes.
	readonly shutdown: Effect.Effect<void>
}

export type ClaudeAdapterOptions = {
	readonly createQuery: (
		input: ClaudeQueryInput
	) => Effect.Effect<ClaudeQueryHandle, ProviderAdapterError>
	readonly presence: Effect.Effect<ProviderPresence>
	// Bounds cancelTurn's call to the SDK's own interrupt(): a hung interrupt
	// promise must never block ProviderBridge's single shared dispatcher fiber
	// forever (that wedges EVERY session in the app, not just this one — see
	// the module doc above cancelTurn). Defaults to 5s.
	readonly cancelInterruptTimeout?: Duration.Input
	// A turn counts as wedged once this much time passes with no stream
	// activity while it's open (a prompt was sent, no turn_complete/turn_error
	// yet). Defaults to 60s — generous enough for a real tool-using turn's
	// natural gaps, short enough to recover a genuinely stalled session
	// without the operator noticing a multi-minute hang.
	readonly turnInactivityTimeout?: Duration.Input
	// How often the watchdog checks for a stalled turn. Defaults to 5s.
	readonly watchdogPollInterval?: Duration.Input
}

const DEFAULT_CANCEL_INTERRUPT_TIMEOUT = Duration.seconds(5)
const DEFAULT_TURN_INACTIVITY_TIMEOUT = Duration.seconds(60)
const DEFAULT_WATCHDOG_POLL_INTERVAL = Duration.seconds(5)

export const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function*(
	options: ClaudeAdapterOptions
) {
	const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionRuntime>())
	const cancelInterruptTimeout = options.cancelInterruptTimeout ?? DEFAULT_CANCEL_INTERRUPT_TIMEOUT
	const turnInactivityTimeout = options.turnInactivityTimeout ?? DEFAULT_TURN_INACTIVITY_TIMEOUT
	const watchdogPollInterval = options.watchdogPollInterval ?? DEFAULT_WATCHDOG_POLL_INTERVAL

	// (Re)attaches a query to an already-registered runtime: a fresh
	// promptQueue feeds a fresh SDK query(), a new listener fiber drains its
	// messages, and both are published atomically via promptQueueRef/queryRef
	// so sendPrompt/cancelTurn always see the current pair. Called once from
	// openSession for a session's first query, and again from cancelTurn /
	// the watchdog to recover from a cancel or a detected stall — resume
	// carries the SDK's own session id across that recovery when known, so
	// the recovered query continues the SAME conversation rather than
	// starting a blank one.
	//
	// The listener is forked into runtime.sessionScope, not the calling
	// fiber's own child tree: a restart can be triggered from ProviderBridge's
	// shared dispatcher fiber (cancelTurn) or the watchdog's own fiber, and
	// forkChild there would parent the listener to a fiber whose lifetime has
	// nothing to do with this session. sessionScope is the one thing that
	// actually spans the session's whole life — see openSession.
	// myGeneration is reserved by the CALLER (Ref.updateAndGet on
	// runtime.generation) before it tears down whatever query came before —
	// never inside attachQuery itself. Ending the old query's inbound queue
	// (teardownQuery's close call) can make its listener fiber's own
	// Effect.ensuring cleanup run before this function gets a chance to run
	// at all, cooperative scheduling gives no ordering guarantee either way —
	// so the generation bump MUST already be visible by the time that old
	// listener checks it, or a cancel/watchdog restart can race its own
	// recovery: the old listener sees a stale "I'm still current" reading and
	// tears the whole session down right as attachQuery is trying to save it.
	const attachQuery = Effect.fn("ClaudeAdapter.attachQuery")(function*(
		runtime: SessionRuntime,
		resume: Option.Option<string>,
		myGeneration: number
	) {
		const promptQueue = yield* Queue.unbounded<ClaudeUserPrompt, Done>()
		const queryHandle = yield* options.createQuery({
			prompt: Stream.toAsyncIterable(Stream.fromQueue(promptQueue)),
			cwd: runtime.workspaceRoot,
			canUseTool: bindCanUseTool(runtime, decidePermission),
			resume
		})
		yield* Ref.set(runtime.promptQueueRef, promptQueue)
		yield* Ref.set(runtime.queryRef, queryHandle)
		const attachedAt = yield* Clock.currentTimeMillis
		yield* Ref.set(runtime.lastActivityAtMs, attachedAt)
		const dropSession = Ref.update(sessions, (current) =>
			HashMap.remove(current, runtime.sessionId)
		)
		yield* queryHandle.messages.pipe(
			Stream.runForEach((raw) =>
				publishSdkMessage(runtime, raw).pipe(
					Effect.andThen(
						Clock.currentTimeMillis.pipe(
							Effect.flatMap((now) => Ref.set(runtime.lastActivityAtMs, now))
						)
					)
				)
			),
			Effect.ensuring(
				Effect.gen(function*() {
					const current = yield* Ref.get(runtime.generation)
					if (current !== myGeneration) {
						// Superseded by attachQuery running again (cancel or
						// watchdog recovery) — the newer generation's listener
						// now owns outbound/sessions, this one just exits quietly.
						// It must NOT drain pendingPermissions either: whoever
						// restarted the query already did, and the map may
						// already hold a permission the NEW query is waiting on.
						return
					}
					// This session is over for good, so every permission it
					// still has in flight is abandoned — see
					// drainPendingPermissions.
					yield* drainPendingPermissions(runtime)
					yield* Queue.end(runtime.outbound).pipe(
						Effect.flatMap(() => dropSession),
						Effect.asVoid
					)
				})
			),
			Effect.forkIn(runtime.sessionScope, { startImmediately: true })
		)
	})

	const watchdogLoop = makeWatchdogLoop(
		watchdogPollInterval,
		turnInactivityTimeout,
		cancelInterruptTimeout,
		attachQuery
	)

	const openSession = Effect.fn("ClaudeAdapter.openSession")(function*(
		request: StartSessionRequest
	) {
		const existing = yield* Ref.get(sessions)
		if (HashMap.has(existing, request.sessionId)) {
			return yield* adapterError(
				"startSession",
				`Claude session '${request.sessionId}' is already open.`
			)
		}
		const outbound = yield* Queue.unbounded<OrchestrationEvent, Done>()
		const streamState = yield* Ref.make(emptyClaudeStreamState)
		const lastUserMessageId = yield* Ref.make(Option.none<MessageId>())
		const sequence = yield* Ref.make(0)
		// See SessionRuntime's own doc and stamp()'s: real wall-clock time,
		// captured once here so it can never collide with whatever epoch a
		// PRIOR process used for this same sessionId (DEFECT D).
		const openEpochMs = yield* Clock.currentTimeMillis
		const pendingPermissions = yield* Ref.make(
			HashMap.empty<string, Deferred.Deferred<ClaudePermissionDecision>>()
		)
		const openToolCalls = yield* Ref.make(HashMap.empty<string, OpenToolCallInfo>())
		const sessionScope = yield* Scope.make()
		const placeholderQueue = yield* Queue.unbounded<ClaudeUserPrompt, Done>()
		const runtime: SessionRuntime = {
			sessionId: request.sessionId,
			workspaceRoot: request.workspaceRoot,
			openEpochMs,
			outbound,
			streamState,
			lastUserMessageId,
			sequence,
			pendingPermissions,
			openToolCalls,
			promptQueueRef: yield* Ref.make(placeholderQueue),
			// Overwritten immediately by the attachQuery call below;
			// requireSession never observes a session without a real query
			// because openSession doesn't register it into `sessions` until
			// after that call returns.
			queryRef: yield* Ref.make<ClaudeQueryHandle>({
				messages: Stream.empty,
				interrupt: Effect.void,
				close: Effect.void
			}),
			generation: yield* Ref.make(-1),
			turnOpenedAtMs: yield* Ref.make(Option.none<number>()),
			lastActivityAtMs: yield* Ref.make(0),
			needsReattach: yield* Ref.make(false),
			sessionScope
		}
		const firstGeneration = yield* Ref.updateAndGet(runtime.generation, (current) => current + 1)
		yield* attachQuery(runtime, Option.none(), firstGeneration)
		yield* Ref.update(sessions, (current) => HashMap.set(current, request.sessionId, runtime))
		yield* watchdogLoop(runtime).pipe(Effect.forkIn(sessionScope, { startImmediately: true }))
		return runtime
	})

	const startSession = (request: StartSessionRequest) =>
		Stream.unwrap(
			Effect.gen(function*() {
				const runtime = yield* openSession(request)
				const opened = yield* makeMetaEvent(runtime, deferredOpenFact)
				return Stream.concat(Stream.make(opened), Stream.fromQueue(runtime.outbound)).pipe(
					// Whether this stream's consumer (ProviderBridge's per-session
					// forwarding fiber) ends normally (outbound got Queue.end'd —
					// see attachQuery's final-generation cleanup) or is interrupted
					// (session archived/deleted), sessionScope must close either
					// way: that's what stops the watchdog and any live query
					// listener from outliving the session.
					Stream.ensuring(Scope.close(runtime.sessionScope, Exit.void))
				)
			})
		)

	// A cancel (see cancelTurn) tears the query down but deliberately leaves
	// reattaching to whoever actually needs it next: sendPrompt checks
	// needsReattach first and, if set, attaches a fresh query (with resume,
	// when the SDK's own session id is known) before offering the prompt —
	// so a follow-up right after a cancel transparently lands on a working
	// query instead of the abandoned one.
	const sendPrompt = (request: SendPromptRequest) =>
		Stream.fromEffect(
			Effect.gen(function*() {
				const runtime = yield* requireSession(sessions, request.sessionId, "sendPrompt")
				const reattachNeeded = yield* Ref.get(runtime.needsReattach)
				if (reattachNeeded) {
					const state = yield* Ref.get(runtime.streamState)
					const nextGeneration = yield* Ref.updateAndGet(
						runtime.generation,
						(current) => current + 1
					)
					yield* attachQuery(runtime, state.providerSessionId, nextGeneration)
					yield* Ref.set(runtime.needsReattach, false)
				}
				yield* Ref.set(runtime.lastUserMessageId, Option.some(request.messageId))
				const state = yield* Ref.get(runtime.streamState)
				const promptQueue = yield* Ref.get(runtime.promptQueueRef)
				yield* Queue.offer(promptQueue, userPrompt(request.text, state.providerSessionId))
				const now = yield* Clock.currentTimeMillis
				yield* Ref.set(runtime.turnOpenedAtMs, Option.some(now))
				yield* Ref.set(runtime.lastActivityAtMs, now)
				return yield* makeMessageSent(runtime, request)
			})
		)

	// Tears down the current query (bounded — see teardownQuery) and marks
	// the session as needing a fresh one, WITHOUT attaching it here: per the
	// SDK's own docs, interrupt() is meant to leave a query ready for more
	// prompts on the same streaming session, but the real QA bug was exactly
	// a wedged interrupt leaving the query unusable afterward, so a fresh
	// query is unconditionally required going forward — just not spawned
	// eagerly. A cancel with no follow-up (the user walked away, or a caller
	// only cancelling for cleanup) must not spawn a real `claude` subprocess
	// nobody asked for; sendPrompt attaches the replacement lazily instead,
	// the same "don't eagerly restart what might not be used" principle
	// ProviderBridge's boot-replay fix already applies at the session level.
	const cancelTurn = Effect.fn("ClaudeAdapter.cancelTurn")(function*(request: CancelTurnRequest) {
		const runtime = yield* requireSession(sessions, request.sessionId, "cancelTurn")
		const cancelled = yield* makeCancelled(runtime)
		yield* offerOutbound(runtime, cancelled).pipe(Effect.ignore)
		yield* Ref.set(runtime.turnOpenedAtMs, Option.none())
		// The cancelled turn's tool call is abandoned with it, and the query
		// that would have run the tool is about to be torn down — so nothing
		// will ever answer a permission it left pending. Drained BEFORE the
		// teardown because teardownQuery's first step is the SDK's own
		// interrupt(), and a wedged interrupt is exactly what a pending
		// canUseTool produces: leaving it for after the teardown would make
		// every cancel-on-a-permission pay the full cancelInterruptTimeout,
		// on ProviderBridge's single shared dispatcher fiber. Drained AGAIN
		// after the teardown, see below. The drain is idempotent: it empties
		// the map, and a second Deferred.succeed on an already-resolved
		// deferred does nothing. See drainPendingPermissions.
		yield* drainPendingPermissions(runtime)
		// Bump generation BEFORE tearing the old query down (not after, and
		// not skipped just because nothing attaches a replacement here): once
		// its inbound queue ends, the old listener's own Effect.ensuring
		// cleanup can run before this function's next line does — cooperative
		// scheduling gives no ordering guarantee — so the "am I still
		// current?" check it makes must already see a bumped generation, or
		// it wrongly concludes it's still canonical and tears the whole
		// session down right as cancelTurn is trying to keep it alive for
		// sendPrompt's later lazy reattach. See attachQuery's own doc.
		yield* Ref.update(runtime.generation, (current) => current + 1)
		const oldQuery = yield* Ref.get(runtime.queryRef)
		yield* teardownQuery(oldQuery, cancelInterruptTimeout)
		// The teardown window: the tool call was already running when the
		// cancel arrived, so the SDK can still reach canUseTool while
		// interrupt() is in flight. A permission raised there survives the
		// drain above, and the old listener's own cleanup skips its drain
		// because the generation bump already told it a newer generation
		// owns the runtime — so nothing else would ever resolve it. Safe
		// here, and only here, because cancelTurn deliberately attaches no
		// replacement query: no NEW query's permission can exist yet, that
		// is sendPrompt's lazy reattach.
		yield* drainPendingPermissions(runtime)
		yield* Ref.set(runtime.needsReattach, true)
	})

	const respondToPermission = makeRespondToPermission(sessions)

	// Forcefully tears down every live session's query — SIGTERM-then-
	// SIGKILL-equivalent (per the SDK's own close() contract, see
	// makeLiveCreateQuery) on app/layer shutdown, not just on an explicit
	// cancel. This is what stops a spawned `claude` subprocess from
	// outliving the app: without a caller invoking this at shutdown, nothing
	// ever tears down a session that neither cancelled nor errored — see
	// ProviderBridge.ts's shutdown finalizer, which calls this on every
	// registered adapter that exposes it.
	const shutdown = Effect.gen(function*() {
		const current = yield* Ref.get(sessions)
		yield* Effect.forEach(
			HashMap.values(current),
			(runtime) =>
				// Drained first, for the same reason the query is torn down at
				// all: an app quitting must not leave the SDK's canUseTool
				// promise pending on a session that is going away, and a
				// pending one wedges teardownQuery's interrupt() until the
				// timeout. Drained again afterwards for the teardown window —
				// same reasoning as cancelTurn's, and safe for the same reason:
				// shutdown attaches no replacement query. See
				// drainPendingPermissions.
				drainPendingPermissions(runtime).pipe(
					Effect.andThen(Ref.get(runtime.queryRef)),
					Effect.flatMap((queryHandle) => teardownQuery(queryHandle, cancelInterruptTimeout)),
					Effect.andThen(drainPendingPermissions(runtime)),
					Effect.andThen(Scope.close(runtime.sessionScope, Exit.void))
				),
			{ discard: true, concurrency: "unbounded" }
		)
	}).pipe(Effect.withSpan("ClaudeAdapter.shutdown"))

	return {
		providerId: CLAUDE_PROVIDER_ID,
		capabilities: CLAUDE_CAPABILITIES,
		presence: options.presence,
		startSession,
		sendPrompt,
		cancelTurn,
		respondToPermission,
		shutdown
	} satisfies ClaudeAdapter
})

export const makeLiveClaudeAdapter = Effect.fn("makeLiveClaudeAdapter")(function*() {
	const presenceValue = yield* probeClaudePresence()
	const executablePath = yield* resolveClaudeExecutablePath()
	return yield* makeClaudeAdapter({
		createQuery: makeLiveCreateQuery({
			pathToClaudeCodeExecutable: executablePath,
			mcpServers: CLAUDE_SESSION_MCP_SERVERS
		}),
		presence: Effect.succeed(presenceValue)
	})
})
