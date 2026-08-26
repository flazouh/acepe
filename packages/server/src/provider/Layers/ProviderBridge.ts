import {
	CommandId,
	EventId,
	type InteractionRepliedEvent,
	type MessageSentEvent,
	type OrchestrationEvent,
	type ProjectId,
	ProviderSessionFailedEvent,
	type SessionCreatedEvent,
	type SessionId,
	type SessionModeSetEvent,
	type Sequence,
	TrimmedNonEmptyString,
	type TurnCancelledEvent
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts"
import {
	decodeProviderId,
	type ProviderAdapter,
	type ProviderAdapterError,
	type ProviderId,
	type SetModeRequest
} from "../Services/ProviderAdapter.ts"
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts"

// Structural, not nominal: any adapter can opt into interactive permission
// prompts by exposing respondToPermission (today only ClaudeAdapter does).
type PermissionRepliableAdapter = ProviderAdapter & {
	readonly respondToPermission: (input: {
		readonly sessionId: SessionId
		readonly permissionId: string
		readonly decision: "allow" | "deny"
	}) => Effect.Effect<void, ProviderAdapterError>
}

const supportsPermissionReply = (adapter: ProviderAdapter): adapter is PermissionRepliableAdapter =>
	"respondToPermission" in adapter

// Structural, same as respondToPermission above: an adapter opts into
// canonical mode switching by exposing setMode, and a provider whose
// transport has no mode mechanism declares the capability absent by not
// exposing it. See SetModeRequest in Services/ProviderAdapter.ts.
type ModeSettableAdapter = ProviderAdapter & {
	readonly setMode: (request: SetModeRequest) => Effect.Effect<void, ProviderAdapterError>
}

const supportsSetMode = (adapter: ProviderAdapter): adapter is ModeSettableAdapter =>
	"setMode" in adapter

// Structural, not nominal, same as respondToPermission above: any adapter can
// opt into a forceful teardown of every live session's spawned subprocess by
// exposing shutdown (today only ClaudeAdapter does — see its own shutdown
// doc for why this is a SIGTERM-then-SIGKILL-equivalent, not a graceful
// request). This is what stops a `claude` CLI child from surviving app quit:
// nothing else ever calls an adapter's teardown path once a session neither
// cancelled nor errored on its own.
type ShutdownCapableAdapter = ProviderAdapter & {
	readonly shutdown: Effect.Effect<void>
}

const supportsShutdown = (adapter: ProviderAdapter): adapter is ShutdownCapableAdapter =>
	"shutdown" in adapter

// Bounds each adapter's own shutdown so one slow or wedged adapter can never
// hold up the app's overall teardown (or the other adapters' — they run
// concurrently) — mirrors ClaudeAdapter's own cancelInterruptTimeout
// reasoning: a shutdown path a caller can't bound isn't actually a shutdown
// path.
const SHUTDOWN_TIMEOUT = Duration.seconds(10)

const shutdownAllAdapters = Effect.fn("ProviderBridge.shutdownAllAdapters")(function*(
	state: BridgeState
) {
	const adapters = yield* state.registry.adapters
	yield* Effect.forEach(
		adapters.filter(supportsShutdown),
		(adapter) =>
			adapter.shutdown.pipe(
				Effect.timeout(SHUTDOWN_TIMEOUT),
				Effect.catchCause((cause) =>
					Effect.logError(cause.pipe(Cause.pretty)).pipe(
						Effect.annotateLogs({ providerId: adapter.providerId, stage: "shutdown" })
					)
				)
			),
		{ discard: true, concurrency: "unbounded" }
	)
})

// ProviderBridge is the engine-driven counterpart to HardcodedProvider.ts for
// SESSIONS THAT PICKED A REAL PROVIDER (session.create carried a providerId
// the ProviderAdapterRegistry can resolve). It never touches sessions the
// tracer already owns: HardcodedProvider claims sessions with no providerId
// exactly as it always has, and this bridge only claims the complement.
//
// Write path: every event this bridge appends came from a ProviderAdapter's
// own Stream<OrchestrationEvent> — the adapter is its own "decider" for
// provider-shaped facts (TokenAppended, SessionMetaUpdated with an encoded
// ClaudeContractFact/CopilotContractFact/etc, ...). Those events flow into
// the store through OrchestrationEngine.appendEvents, which reuses the
// engine's single-writer queue and commit transaction — there is exactly one
// place that calls OrchestrationEventStore.append. MessageSent and
// TurnCancelled are filtered out of every adapter stream before appending:
// both already exist as engine-committed events (from the message.send and
// turn.cancel commands that trigger sendPrompt/cancelTurn below), so the
// adapter's own copies of those two event types would be exact duplicates.
//
// Fiber model: exactly one long-lived fiber per real-provider session, the
// one forwarding adapter.startSession(...)'s stream. sendPrompt and
// cancelTurn are quick, synchronous reactions run inline in the main event
// loop — their returned streams/effects resolve immediately (the actual
// token/tool traffic already flows through the already-open startSession
// stream); see Claude/Adapter.ts and Cursor/Adapter.ts, where sendPrompt's
// stream carries nothing but the (filtered) echo MessageSent, and
// cancelTurn's own TurnCancelled duplicate is queued onto the SAME outbound
// queue the startSession stream is already draining. If a session's stream
// dies (adapter/subprocess/SDK failure), the bridge appends a typed
// ProviderSessionFailed event instead of leaving the session silently
// stalled.

type WorkspaceRoot = typeof TrimmedNonEmptyString.Type

type BridgeState = {
	readonly engine: OrchestrationEngine["Service"]
	readonly registry: ProviderAdapterRegistry["Service"]
	readonly sessionAdapters: Ref.Ref<HashMap.HashMap<SessionId, ProviderAdapter>>
	readonly sessionFibers: Ref.Ref<HashMap.HashMap<SessionId, Fiber.Fiber<void>>>
	// The projectId each known session belongs to, kept independent of
	// whether the session's adapter pipeline has actually been opened yet —
	// see ensureSessionOpen: a session learned about during startup replay
	// (considerSessionCreated with phase "replay") records here without
	// opening, so a later live command can lazily open it on demand.
	readonly sessionProjects: Ref.Ref<HashMap.HashMap<SessionId, ProjectId>>
	// The mode every known session last had set, read straight off the
	// canonical SessionModeSet events (both the live ones and the startup
	// replay's). A session opens lazily, long after the SessionModeSet that
	// chose its mode was committed, so openSession applies whatever is
	// recorded here to the freshly opened adapter session -- that is what
	// makes a replayed mode survive a restart without replay itself ever
	// opening a session. See considerSessionModeSet.
	readonly sessionModes: Ref.Ref<HashMap.HashMap<SessionId, SetModeRequest["modeId"]>>
	readonly projectRoots: Ref.Ref<HashMap.HashMap<ProjectId, WorkspaceRoot>>
	readonly claimedSessions: Ref.Ref<HashSet.HashSet<string>>
	readonly claimedMessages: Ref.Ref<HashSet.HashSet<string>>
	readonly claimedCancellations: Ref.Ref<HashSet.HashSet<string>>
	readonly claimedReplies: Ref.Ref<HashSet.HashSet<string>>
	readonly claimedModeSets: Ref.Ref<HashSet.HashSet<string>>
	// Monotonic counter for stamping the bridge's own ProviderSessionFailed
	// events with a unique commandId/eventId — mirrors the per-runtime
	// sequence counter Claude/Adapter.ts/Cursor/Adapter.ts use for the same
	// purpose, rather than reaching for Date.now()/Math.random() (banned by
	// the Effect lint ratchet) or a fresh Crypto call for a rare failure path.
	readonly failureSeq: Ref.Ref<number>
	// Per-session forwarding fibers are forked into the SAME long-lived scope
	// as the bridge's own main listener (not Effect.forkChild off whatever
	// transient fiber happens to be processing the triggering event) so they
	// keep running for the session's whole lifetime, independent of the
	// per-event call stack that started them.
	readonly layerScope: Scope.Scope
}

const EVENT_PAGE_SIZE = 1_000

type EventStoreShape = {
	readonly readFrom: OrchestrationEventStore["Service"]["readFrom"]
}

const readAllFrom = Effect.fn("ProviderBridge.readAllFrom")(function*(
	store: EventStoreShape,
	fromSequence: Sequence
) {
	let cursor = fromSequence
	let acc: ReadonlyArray<OrchestrationEvent> = Arr.empty()
	while (true) {
		const page = yield* Stream.runCollect(store.readFrom(cursor, EVENT_PAGE_SIZE))
		if (!Arr.isReadonlyArrayNonEmpty(page)) {
			return acc
		}
		acc = Arr.appendAll(acc, page)
		cursor = Arr.lastNonEmpty(page).sequence
		if (page.length < EVENT_PAGE_SIZE) {
			return acc
		}
	}
})

// claim() gives every reaction below at-most-once semantics per key: the
// bridge sees each committed event twice (once during the historical replay
// on startup, once again live if it arrives after the replay races it), and
// separately a session's stream may legitimately deliver more than one
// TurnCancelled/MessageSent over its lifetime, so the claim key always
// identifies the SPECIFIC event/message, never just the session.
const claim = (ref: Ref.Ref<HashSet.HashSet<string>>, key: string) =>
	Ref.modify(ref, (set) => {
		if (HashSet.has(set, key)) {
			return [false, set] as const
		}
		return [true, HashSet.add(set, key)] as const
	})

const providerSessionFailedEvent = Effect.fn("ProviderBridge.providerSessionFailedEvent")(function*(
	state: BridgeState,
	sessionId: SessionId,
	providerId: ProviderId,
	operation: ProviderAdapterError["operation"],
	detail: string
) {
	const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
	const seq = yield* Ref.updateAndGet(state.failureSeq, (current) => current + 1)
	const commandId = CommandId.make(`provider-bridge:${sessionId}:${seq}`)
	return ProviderSessionFailedEvent.make({
		sequence: 0,
		eventId: EventId.make(`provider-bridge:${sessionId}:${seq}`),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "ProviderSessionFailed",
		payload: {
			sessionId,
			providerId,
			operation,
			detail: detail.length > 0 ? detail : "Provider adapter failed with no further detail."
		}
	})
})

const appendFailure = (
	state: BridgeState,
	sessionId: SessionId,
	providerId: ProviderId,
	operation: ProviderAdapterError["operation"],
	detail: string
) =>
	providerSessionFailedEvent(state, sessionId, providerId, operation, detail).pipe(
		Effect.flatMap((event) => state.engine.appendEvents(Arr.of(event))),
		Effect.asVoid,
		Effect.catchCause((cause) =>
			Effect.logError(cause.pipe(Cause.pretty)).pipe(
				Effect.annotateLogs({ sessionId, providerId, operation, stage: "appendFailure" })
			)
		)
	)

// Adapter events flow one at a time so ordering is preserved and a stream
// failure surfaces exactly the event that was in flight when it died. The
// failure can come from the adapter itself (ProviderAdapterError) or from
// the engine's commit path (OrchestrationDispatchError, e.g. a SqlError) —
// catchCause + Cause.pretty handles both uniformly instead of assuming a
// single error shape, matching HardcodedProvider.ts's own error handling.
const forwardAdapterEvents = (
	state: BridgeState,
	sessionId: SessionId,
	providerId: ProviderId,
	operation: ProviderAdapterError["operation"],
	events: Stream.Stream<OrchestrationEvent, ProviderAdapterError>
) =>
	events.pipe(
		// MessageSent/TurnCancelled from the adapter are always duplicates of
		// an event the engine already committed from the message.send /
		// turn.cancel command that triggered this call — see the module doc.
		Stream.filter((event) => event.type !== "MessageSent" && event.type !== "TurnCancelled"),
		Stream.mapEffect((event) => state.engine.appendEvents(Arr.of(event)).pipe(Effect.asVoid)),
		Stream.runDrain,
		Effect.catchCause((cause) =>
			appendFailure(state, sessionId, providerId, operation, Cause.pretty(cause))
		)
	)

// KNOWN RACE (documented, not fixed in this lane): openSession forks the
// forwarding fiber and returns immediately without waiting for the adapter
// to finish its own internal "session open" bookkeeping (e.g. ClaudeAdapter
// only registers a session once its startSession stream actually starts
// running). A message.send dispatched immediately after session.create —
// before that fiber gets scheduled — could theoretically race sendPrompt
// against the adapter and fail with a "no such session" ProviderAdapterError
// (surfaced as ProviderSessionFailed, not a silent stall). A prior attempt
// to close this with a Deferred the caller awaits deadlocked under this
// Effect version's fiber scheduler in tests and was reverted rather than
// land unproven; the natural latency between a user seeing "session
// created" and typing a message makes this unlikely to bite in practice.
const openSession = Effect.fn("ProviderBridge.openSession")(function*(
	state: BridgeState,
	sessionId: SessionId,
	projectId: ProjectId,
	adapter: ProviderAdapter
) {
	const roots = yield* Ref.get(state.projectRoots)
	const workspaceRoot = HashMap.get(roots, projectId)
	if (Option.isNone(workspaceRoot)) {
		yield* appendFailure(
			state,
			sessionId,
			adapter.providerId,
			"startSession",
			`No known workspace root for project '${projectId}'.`
		)
		return
	}
	// AC-271: a project's root can go stale or arrive corrupted (e.g. the
	// desktop app's cross-instance localStorage cache bleed -- see
	// project-manager.svelte.ts's reconcileKnownProjectRoots) without this
	// server ever hearing about it changing. Checking existence here, before
	// ever calling the adapter, turns that into one honest
	// ProviderSessionFailed instead of an adapter-specific spawn error (a
	// `claude`/`codex`/etc. subprocess failing to start in a cwd that does
	// not exist) -- ead04058f already stopped that from hanging the turn
	// forever, this makes the failure legible instead of merely non-fatal.
	const fs = yield* FileSystem.FileSystem
	const rootExists = yield* fs.exists(workspaceRoot.value).pipe(Effect.orElseSucceed(() => false))
	if (rootExists === false) {
		yield* appendFailure(
			state,
			sessionId,
			adapter.providerId,
			"startSession",
			`Workspace root '${workspaceRoot.value}' does not exist. The project folder may have been moved, deleted, or its path corrupted.`
		)
		return
	}
	yield* Ref.update(state.sessionAdapters, (current) => HashMap.set(current, sessionId, adapter))
	yield* Ref.update(state.sessionProjects, (current) => HashMap.set(current, sessionId, projectId))
	const fiber = yield* forwardAdapterEvents(
		state,
		sessionId,
		adapter.providerId,
		"startSession",
		adapter.startSession({
			sessionId,
			projectId,
			workspaceRoot: workspaceRoot.value
		})
	).pipe(Effect.forkIn(state.layerScope, { startImmediately: true }))
	yield* Ref.update(state.sessionFibers, (current) => HashMap.set(current, sessionId, fiber))
	// The adapter session that just opened starts at its own default mode, so
	// the canonical mode this session already chose has to be re-applied --
	// otherwise a mode set before a restart, or before this session's lazy
	// (re)open, silently reverts on the next turn. Retried for the same
	// scheduling-lag reason sendPrompt's own lazy-open path is (see
	// LAZY_OPEN_RETRY_SCHEDULE): the forwarding fiber above was only just
	// forked, so the adapter may not have registered the session yet.
	const modes = yield* Ref.get(state.sessionModes)
	const modeId = HashMap.get(modes, sessionId)
	if (Option.isSome(modeId) && supportsSetMode(adapter)) {
		yield* applySetMode(state, adapter, sessionId, modeId.value, true)
	}
})

// Boot replay walks EVERY historical SessionCreated event, including ones for
// sessions that finished long ago and are not actively being used. Eagerly
// re-opening every one of them on every boot would (a) needlessly spawn a
// real provider session — a real `claude` subprocess, in ClaudeAdapter's case
// — for sessions nobody is looking at, and (b) restart the adapter's own
// per-runtime sequence counter from zero, re-deriving the SAME deterministic
// eventIds (see Claude/Adapter.ts's `stamp`) it already committed in a prior
// run, which the store's UNIQUE(event_id) constraint then rejects — the
// resumed session comes back broken instead of merely idle. So a session
// only gets ensureSessionOpen'd lazily, the next time it actually receives a
// live command (message.send, turn.cancel, ...) — see ensureSessionOpen.
const ensureSessionOpen = Effect.fn("ProviderBridge.ensureSessionOpen")(function*(
	state: BridgeState,
	sessionId: SessionId
) {
	const fibers = yield* Ref.get(state.sessionFibers)
	const existing = HashMap.get(fibers, sessionId)
	// pollUnsafe() === undefined means the fiber is still running — the
	// common case once a session has been opened once, live or lazily. A
	// completed fiber (Some, whichever Exit) means a prior open attempt died
	// (e.g. its own startSession failed) and left a stale entry behind:
	// reopening here is what stops that from permanently poisoning the
	// session — appendFailure alone never retries.
	if (Option.isSome(existing) && existing.value.pollUnsafe() === undefined) {
		return false
	}
	const adapters = yield* Ref.get(state.sessionAdapters)
	const adapter = HashMap.get(adapters, sessionId)
	if (Option.isNone(adapter)) {
		return false
	}
	const projects = yield* Ref.get(state.sessionProjects)
	const projectId = HashMap.get(projects, sessionId)
	if (Option.isNone(projectId)) {
		return false
	}
	yield* openSession(state, sessionId, projectId.value, adapter.value)
	return true
})

// openSession forks the forwarding fiber and returns immediately without
// waiting for the adapter to finish its own internal "session open"
// bookkeeping (e.g. ClaudeAdapter only registers a session once its
// startSession stream actually starts running). A command dispatched right
// after — before that fiber gets scheduled — can race the adapter and fail
// with a "no such session" ProviderAdapterError (surfaced as
// ProviderSessionFailed, not a silent stall). For a live session.create
// followed by a human typing a message, the natural latency makes this
// unlikely; for ensureSessionOpen's lazy (re)open, dispatched from the SAME
// live command that needed the session open, there is no such latency, so
// the very next call below retries briefly instead of surfacing a failure
// for what is really just scheduling lag. A prior attempt to close this race
// with a Deferred the caller awaits deadlocked under this Effect version's
// fiber scheduler in tests and was reverted rather than land unproven; this
// bounded retry sidesteps that without needing the same synchronization.
const LAZY_OPEN_RETRY_SCHEDULE = Schedule.spaced(Duration.millis(20)).pipe(
	Schedule.upTo({ times: 25 })
)

// The ONE failure LAZY_OPEN_RETRY_SCHEDULE exists to absorb. Every adapter's
// requireSession (Claude/Codex/Cursor/OpenCode Session.ts) renders a session
// it has not registered yet as `No <Provider> session '<sessionId>'.`, and
// that stops the moment the just-forked forwarding fiber's startSession
// registers it. Every other setMode failure is permanent: a mode the provider
// has no equivalent for (resolveClaudeModeId, resolveCodexModeId and their
// siblings returning none) fails identically on the first attempt and on all
// 25 retries, so retrying it burns ~500 ms of the bridge's single
// event-consuming fiber -- delaying every other session's events -- before
// appending exactly the ProviderSessionFailed the first attempt already
// earned. The rendered detail is the narrowest discriminant this file has:
// ProviderAdapterError carries no transient/permanent field, and promoting
// one belongs in Services/ProviderAdapter.ts with every adapter, not here.
const isSessionNotRegisteredYet = (sessionId: SessionId) => (error: ProviderAdapterError) =>
	error.detail.startsWith("No ") && error.detail.endsWith(`session '${sessionId}'.`)

const applySetMode = (
	state: BridgeState,
	adapter: ModeSettableAdapter,
	sessionId: SessionId,
	modeId: SetModeRequest["modeId"],
	justOpened: boolean
) => {
	const dispatch = adapter.setMode({ sessionId, modeId })
	const attempt = justOpened
		? Effect.retry(dispatch, {
			schedule: LAZY_OPEN_RETRY_SCHEDULE,
			while: isSessionNotRegisteredYet(sessionId)
		})
		: dispatch
	return attempt.pipe(
		Effect.catchCause((cause) =>
			appendFailure(state, sessionId, adapter.providerId, "setMode", Cause.pretty(cause))
		)
	)
}

const considerSessionCreated = Effect.fn("ProviderBridge.considerSessionCreated")(function*(
	state: BridgeState,
	event: SessionCreatedEvent,
	phase: "live" | "replay"
) {
	if (event.payload.providerId === undefined) {
		return
	}
	const claimed = yield* claim(state.claimedSessions, event.payload.sessionId)
	if (!claimed) {
		return
	}
	const providerId = yield* decodeProviderId(event.payload.providerId).pipe(Effect.option)
	if (Option.isNone(providerId)) {
		return
	}
	const found = yield* state.registry.get(providerId.value)
	if (Option.isNone(found)) {
		yield* appendFailure(
			state,
			event.payload.sessionId,
			providerId.value,
			"startSession",
			`No provider adapter is registered for '${providerId.value}'.`
		)
		return
	}
	if (phase === "replay") {
		// Record the mapping so ensureSessionOpen can lazily open this
		// session later, without spawning anything now — see the doc above
		// ensureSessionOpen for why replay must never eagerly open.
		yield* Ref.update(state.sessionAdapters, (current) =>
			HashMap.set(current, event.payload.sessionId, found.value))
		yield* Ref.update(state.sessionProjects, (current) =>
			HashMap.set(current, event.payload.sessionId, event.payload.projectId))
		return
	}
	yield* openSession(state, event.payload.sessionId, event.payload.projectId, found.value)
})

// Historical replay must never re-dispatch a command reaction to a real
// adapter: every one of these events already ran its adapter call, once, in
// whatever earlier boot actually processed it live. Re-running sendPrompt/
// cancelTurn/respondToPermission against a FRESH adapter session for a
// message sent hours or days ago would be at best a wasted duplicate call and
// at worst (see ensureSessionOpen's doc) exactly the kind of spawn-on-boot
// that broke old sessions in the first place. Replay's only job for these
// three is the same bookkeeping claim() already did for the "seen this event
// both during replay and live" case the module doc describes — so a live
// redelivery of a just-replayed event is still correctly deduped.
const considerMessageSent = Effect.fn("ProviderBridge.considerMessageSent")(function*(
	state: BridgeState,
	event: MessageSentEvent,
	phase: "live" | "replay"
) {
	const claimed = yield* claim(state.claimedMessages, event.payload.messageId)
	if (!claimed || phase === "replay") {
		return
	}
	const justOpened = yield* ensureSessionOpen(state, event.payload.sessionId)
	const adapters = yield* Ref.get(state.sessionAdapters)
	const adapter = HashMap.get(adapters, event.payload.sessionId)
	if (Option.isNone(adapter)) {
		return
	}
	const dispatch = adapter.value.sendPrompt({
		sessionId: event.payload.sessionId,
		messageId: event.payload.messageId,
		text: event.payload.text
	})
	yield* forwardAdapterEvents(
		state,
		event.payload.sessionId,
		adapter.value.providerId,
		"sendPrompt",
		justOpened ? Stream.retry(dispatch, LAZY_OPEN_RETRY_SCHEDULE) : dispatch
	)
})

const considerTurnCancelled = Effect.fn("ProviderBridge.considerTurnCancelled")(function*(
	state: BridgeState,
	event: TurnCancelledEvent,
	phase: "live" | "replay"
) {
	const claimed = yield* claim(state.claimedCancellations, event.eventId)
	if (!claimed || phase === "replay") {
		return
	}
	const justOpened = yield* ensureSessionOpen(state, event.payload.sessionId)
	const adapters = yield* Ref.get(state.sessionAdapters)
	const adapter = HashMap.get(adapters, event.payload.sessionId)
	if (Option.isNone(adapter)) {
		return
	}
	const dispatch = adapter.value.cancelTurn({
		sessionId: event.payload.sessionId,
		...(event.payload.turnId === undefined ? {} : { turnId: event.payload.turnId })
	})
	yield* (justOpened ? Effect.retry(dispatch, LAZY_OPEN_RETRY_SCHEDULE) : dispatch).pipe(
		Effect.catchCause((cause) =>
			appendFailure(state, event.payload.sessionId, adapter.value.providerId, "cancelTurn", Cause.pretty(cause))
		)
	)
})

const considerInteractionReplied = Effect.fn("ProviderBridge.considerInteractionReplied")(function*(
	state: BridgeState,
	event: InteractionRepliedEvent,
	phase: "live" | "replay"
) {
	const claimed = yield* claim(state.claimedReplies, event.eventId)
	if (!claimed || phase === "replay") {
		return
	}
	const justOpened = yield* ensureSessionOpen(state, event.payload.sessionId)
	const adapters = yield* Ref.get(state.sessionAdapters)
	const adapter = HashMap.get(adapters, event.payload.sessionId)
	if (Option.isNone(adapter)) {
		return
	}
	// Only adapters that support interactive permission prompts (today just
	// ClaudeAdapter.respondToPermission) need this reaction — the reply is
	// already durably recorded as an InteractionReplied event regardless, so
	// adapters without the capability need nothing further here.
	if (!supportsPermissionReply(adapter.value)) {
		return
	}
	const dispatch = adapter.value.respondToPermission({
		sessionId: event.payload.sessionId,
		permissionId: event.payload.approvalRequestId,
		decision: event.payload.decision
	})
	yield* (justOpened ? Effect.retry(dispatch, LAZY_OPEN_RETRY_SCHEDULE) : dispatch).pipe(
		Effect.catchCause((cause) =>
			appendFailure(
				state,
				event.payload.sessionId,
				adapter.value.providerId,
				"respondToPermission",
				Cause.pretty(cause)
			)
		)
	)
})

// Issue #272: session.set-mode commits a SessionModeSet event that no
// projection and no adapter ever read, so plan mode was decided, persisted,
// and then dropped. The bridge reacts to the canonical EVENT rather than the
// command, so the mode a session already chose is re-applied whenever its
// adapter session (re)opens -- see state.sessionModes and openSession.
const considerSessionModeSet = Effect.fn("ProviderBridge.considerSessionModeSet")(function*(
	state: BridgeState,
	event: SessionModeSetEvent,
	phase: "live" | "replay"
) {
	// Recorded on BOTH phases, unlike every other reaction here: replay's job
	// for a mode is precisely to leave the last one behind for openSession to
	// apply later. Recording is not opening -- see ensureSessionOpen's doc for
	// why replay must never open a session.
	yield* Ref.update(state.sessionModes, (current) =>
		HashMap.set(current, event.payload.sessionId, event.payload.modeId))
	const claimed = yield* claim(state.claimedModeSets, event.eventId)
	if (!claimed || phase === "replay") {
		return
	}
	const justOpened = yield* ensureSessionOpen(state, event.payload.sessionId)
	if (justOpened) {
		// openSession applied the mode recorded above already.
		return
	}
	const adapters = yield* Ref.get(state.sessionAdapters)
	const adapter = HashMap.get(adapters, event.payload.sessionId)
	if (Option.isNone(adapter)) {
		return
	}
	// A provider whose transport has no mode mechanism declares the
	// capability absent by exposing no setMode; the mode stays durably
	// recorded as a SessionModeSet event either way.
	if (!supportsSetMode(adapter.value)) {
		return
	}
	yield* applySetMode(
		state,
		adapter.value,
		event.payload.sessionId,
		event.payload.modeId,
		false
	)
})

const considerSessionRemoved = Effect.fn("ProviderBridge.considerSessionRemoved")(function*(
	state: BridgeState,
	sessionId: SessionId
) {
	const fibers = yield* Ref.get(state.sessionFibers)
	const fiber = HashMap.get(fibers, sessionId)
	yield* Ref.update(state.sessionFibers, (current) => HashMap.remove(current, sessionId))
	yield* Ref.update(state.sessionAdapters, (current) => HashMap.remove(current, sessionId))
	yield* Ref.update(state.sessionProjects, (current) => HashMap.remove(current, sessionId))
	yield* Ref.update(state.sessionModes, (current) => HashMap.remove(current, sessionId))
	if (Option.isSome(fiber)) {
		yield* Fiber.interrupt(fiber.value)
	}
})

const consider = Effect.fn("ProviderBridge.consider")(function*(
	state: BridgeState,
	event: OrchestrationEvent,
	phase: "live" | "replay" = "live"
) {
	switch (event.type) {
		case "SessionCreated":
			return yield* considerSessionCreated(state, event, phase)
		case "MessageSent":
			return yield* considerMessageSent(state, event, phase)
		case "TurnCancelled":
			return yield* considerTurnCancelled(state, event, phase)
		case "InteractionReplied":
			return yield* considerInteractionReplied(state, event, phase)
		case "SessionModeSet":
			return yield* considerSessionModeSet(state, event, phase)
		case "ProjectCreated":
			return yield* Ref.update(state.projectRoots, (current) =>
				HashMap.set(current, event.payload.projectId, event.payload.workspaceRoot))
		case "ProjectMetaUpdated": {
			const workspaceRoot = event.payload.workspaceRoot
			if (workspaceRoot === undefined) {
				return
			}
			return yield* Ref.update(state.projectRoots, (current) =>
				HashMap.set(current, event.payload.projectId, workspaceRoot))
		}
		case "SessionArchived":
		case "SessionDeleted":
			return yield* considerSessionRemoved(state, event.payload.sessionId)
		default:
			return
	}
})

export const makeProviderBridge = Effect.fn("makeProviderBridge")(function*() {
	const engine = yield* OrchestrationEngine
	const registry = yield* ProviderAdapterRegistry
	const store = yield* OrchestrationEventStore
	const layerScope = yield* Effect.scope

	const state: BridgeState = {
		engine,
		registry,
		sessionAdapters: yield* Ref.make(HashMap.empty<SessionId, ProviderAdapter>()),
		sessionFibers: yield* Ref.make(HashMap.empty<SessionId, Fiber.Fiber<void>>()),
		sessionProjects: yield* Ref.make(HashMap.empty<SessionId, ProjectId>()),
		sessionModes: yield* Ref.make(HashMap.empty<SessionId, SetModeRequest["modeId"]>()),
		projectRoots: yield* Ref.make(HashMap.empty<ProjectId, WorkspaceRoot>()),
		claimedSessions: yield* Ref.make(HashSet.empty<string>()),
		claimedMessages: yield* Ref.make(HashSet.empty<string>()),
		claimedCancellations: yield* Ref.make(HashSet.empty<string>()),
		claimedReplies: yield* Ref.make(HashSet.empty<string>()),
		claimedModeSets: yield* Ref.make(HashSet.empty<string>()),
		failureSeq: yield* Ref.make(0),
		layerScope
	}

	// Runs on app quit / the bridge's own layer scope closing — see
	// shutdownAllAdapters and Claude/Adapter.ts's shutdown for why this is
	// what reaps a spawned `claude` subprocess instead of leaving it
	// orphaned. Registered on layerScope specifically (not the ambient scope
	// makeProviderBridge happens to run in) so it fires exactly once, when
	// THIS bridge instance's lifetime actually ends.
	yield* Effect.addFinalizer(() => shutdownAllAdapters(state))

	yield* Effect.forkIn(
		engine.streamDomainEvents.pipe(Stream.runForEach((event) => consider(state, event))),
		layerScope,
		{ startImmediately: true }
	)
	const historical = yield* readAllFrom(store, 0)
	yield* Effect.forEach(historical, (event) => consider(state, event, "replay"), { discard: true })
})

// Self-contained: provides its own FileSystem (the openSession root-exists
// check, AC-271) rather than requiring every caller/test to thread
// BunFileSystem.layer through -- same pattern persistence/Layers/Sqlite.ts
// uses for its own FileSystem dependency.
export const ProviderBridgeLive = Layer.effectDiscard(makeProviderBridge()).pipe(
	Layer.provide(BunFileSystem.layer)
)
