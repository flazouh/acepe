import {
	CommandId,
	EventId,
	MessageId,
	MessageSendCommand,
	MessageSentEvent,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId,
	TokenAppendedEvent,
	TRACER_REPLY_TEXT,
	TurnCancelCommand,
	TurnCompletedEvent
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { OrchestrationCommandReceiptsLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../../persistence/Migrations.ts"
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import { HardcodedProvider, HardcodedProviderLive } from "../HardcodedProvider.ts"
import {
	type ProviderAdapter,
	ProviderCapabilities,
	ProviderId,
	ProviderAdapterError
} from "../Services/ProviderAdapter.ts"
import { makeClaudeAdapter, type ClaudeQueryHandle } from "./Claude/Adapter.ts"
import { claudePresence } from "./Claude/Provider.ts"
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts"
import { ProviderBridgeLive } from "./ProviderBridge.ts"

type Json = typeof Schema.Json.Type

const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-real")
const tracerSessionId = SessionId.make("session-tracer")
const userMessageId = MessageId.make("message-user")
const tracerMessageId = MessageId.make("message-tracer")
const fakeProviderId = ProviderId.make("fake-provider")

const TempSqlite = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return makeSqliteLayer({
			filename: path.join(dir, "acepe-test.db"),
			readonly: false
		})
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

// ProviderBridge has no public Service/waitFor hook (unlike HardcodedProvider
// — it is a fire-and-forget engine-driven Layer, see ProviderBridge.ts), so
// tests poll the store for the expected shape instead of a fixed sleep: this
// resolves as soon as the bridge's fibers have caught up, and still bounds
// worst-case wait time if a reaction never fires.
const waitUntil = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	predicate: (value: A) => boolean,
	attempts = 200
): Effect.Effect<A, E, R> =>
	Effect.gen(function*() {
		let last = yield* effect
		let remaining = attempts
		while (!predicate(last) && remaining > 0) {
			yield* Effect.sleep(Duration.millis(10))
			last = yield* effect
			remaining -= 1
		}
		return last
	})

// A scripted ProviderAdapter: startSession's stream is backed by a queue the
// test drives directly (push events, or fail it, whenever it wants), and
// cancelTurn/sendPrompt calls are observable via refs. This is what the task
// calls a "FAKE ProviderAdapter (scripted event streams)".
const makeScriptedAdapter = Effect.fn("makeScriptedAdapter")(function*(providerId: ProviderId) {
	const startEvents = yield* Queue.unbounded<
		import("@acepe/contracts").OrchestrationEvent,
		Done
	>()
	const cancelCount = yield* Ref.make(0)
	const sendPromptCount = yield* Ref.make(0)
	const startSessionCount = yield* Ref.make(0)

	const adapter: ProviderAdapter = {
		providerId,
		capabilities: ProviderCapabilities.make({ enabled: [] }),
		presence: Effect.succeed({ providerId, installed: true, authenticated: true }),
		startSession: () =>
			Stream.unwrap(
				Ref.update(startSessionCount, (count) => count + 1).pipe(
					Effect.as(Stream.fromQueue(startEvents))
				)
			),
		sendPrompt: (request) =>
			Stream.fromEffect(
				Ref.update(sendPromptCount, (count) => count + 1).pipe(
					Effect.as(
						MessageSentEvent.make({
							sequence: 0,
							eventId: EventId.make(`fake:${request.messageId}`),
							aggregateKind: "session",
							aggregateId: request.sessionId,
							occurredAt: "2026-08-24T00:00:00.000Z",
							commandId: CommandId.make(`fake:${request.messageId}`),
							causationEventId: null,
							correlationId: CommandId.make(`fake:${request.messageId}`),
							metadata: {},
							type: "MessageSent",
							payload: {
								sessionId: request.sessionId,
								messageId: request.messageId,
								text: request.text
							}
						})
					)
				)
			),
		cancelTurn: () => Ref.update(cancelCount, (count) => count + 1).pipe(Effect.asVoid)
	}

	return { adapter, startEvents, cancelCount, sendPromptCount, startSessionCount }
})

const scriptedToken = (index: number, text: string) =>
	TokenAppendedEvent.make({
		sequence: 0,
		eventId: EventId.make(`fake-token-${index}`),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: "2026-08-24T00:00:00.000Z",
		commandId: CommandId.make(`fake-token-${index}`),
		causationEventId: null,
		correlationId: CommandId.make(`fake-token-${index}`),
		metadata: {},
		type: "TokenAppended",
		payload: {
			sessionId,
			messageId: MessageId.make(`${sessionId}:assistant`),
			token: text
		}
	})

const scriptedTurnCompleted = () =>
	TurnCompletedEvent.make({
		sequence: 0,
		eventId: EventId.make("fake-turn-complete"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: "2026-08-24T00:00:00.000Z",
		commandId: CommandId.make("fake-turn-complete"),
		causationEventId: null,
		correlationId: CommandId.make("fake-turn-complete"),
		metadata: {},
		type: "TurnCompleted",
		payload: {
			sessionId
		}
	})

Vitest.describe("ProviderBridge", () => {
	Vitest.it.live("forwards a scripted adapter's events into the store in order", () =>
		makeScriptedAdapter(fakeProviderId).pipe(
			Effect.flatMap(({ adapter, startEvents, startSessionCount }) => {
				const TestLive = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([adapter])),
					Layer.provideMerge(EngineLive)
				)
				return Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const store = yield* OrchestrationEventStore
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					yield* engine.dispatch(
						SessionCreateCommand.make({
							type: "session.create",
							commandId: CommandId.make("cmd-session"),
							sessionId,
							projectId,
							title: "Real provider session",
							providerId: fakeProviderId
						})
					)
					const startedCount = yield* waitUntil(Ref.get(startSessionCount), (value) => value >= 1)
					Vitest.assert.strictEqual(startedCount, 1)
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message"),
							sessionId,
							messageId: userMessageId,
							text: "Ping"
						})
					)
					// Queue.offer buffers regardless of whether the bridge's forwarding
					// fiber has started consuming yet, so these can be pushed right
					// away — no need to wait for startSession/sendPrompt first.
					yield* Queue.offer(startEvents, scriptedToken(0, "Hello"))
					yield* Queue.offer(startEvents, scriptedToken(1, " world"))

					const events = yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 50)),
						(collected) => collected.filter((event) => event.type === "TokenAppended").length >= 2
					)
					const tokens = events.filter((event) => event.type === "TokenAppended")
					Vitest.assert.strictEqual(tokens.length, 2)
					Vitest.assert.deepStrictEqual(
						tokens.map((event) => (event.type === "TokenAppended" ? event.payload.token : "")),
						["Hello", " world"]
					)
					// Sequences must be strictly increasing (real, store-assigned
					// sequences — not the caller-local placeholder of 0).
					Vitest.assert.isTrue(tokens[0]!.sequence > 0)
					Vitest.assert.isTrue(tokens[1]!.sequence > tokens[0]!.sequence)

					// The adapter's own echoed MessageSent (from sendPrompt) must
					// be filtered — only the command-derived MessageSent exists.
					const messageSent = events.filter((event) => event.type === "MessageSent")
					Vitest.assert.strictEqual(messageSent.length, 1)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(TestLive)
				)
			})
		)
	)

	// Locks in that ProviderBridge's MessageSent/TurnCancelled de-dup filter
	// (forwardAdapterEvents in ProviderBridge.ts) does NOT also catch
	// TurnCompleted — a real adapter's own turn-end signal (ClaudeAdapter.ts's
	// makeCompleted, etc.) must reach the store, or projection_turns can never
	// close a turn no matter what the adapter emits.
	Vitest.it.live("forwards the adapter's own TurnCompleted into the store", () =>
		makeScriptedAdapter(fakeProviderId).pipe(
			Effect.flatMap(({ adapter, startEvents, startSessionCount }) => {
				const TestLive = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([adapter])),
					Layer.provideMerge(EngineLive)
				)
				return Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const store = yield* OrchestrationEventStore
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					yield* engine.dispatch(
						SessionCreateCommand.make({
							type: "session.create",
							commandId: CommandId.make("cmd-session"),
							sessionId,
							projectId,
							title: "Real provider session",
							providerId: fakeProviderId
						})
					)
					yield* waitUntil(Ref.get(startSessionCount), (value) => value >= 1)
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message"),
							sessionId,
							messageId: userMessageId,
							text: "Reply with exactly: TURN_42"
						})
					)
					yield* Queue.offer(startEvents, scriptedToken(0, "TURN_42"))
					yield* Queue.offer(startEvents, scriptedTurnCompleted())

					const events = yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 50)),
						(collected) => collected.some((event) => event.type === "TurnCompleted")
					)
					const completed = events.filter((event) => event.type === "TurnCompleted")
					Vitest.assert.strictEqual(completed.length, 1)
					Vitest.assert.isTrue(completed[0]!.sequence > 0)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(TestLive)
				)
			})
		)
	)

	Vitest.it.live("routes turn.cancel to the adapter's cancelTurn", () =>
		makeScriptedAdapter(fakeProviderId).pipe(
			Effect.flatMap(({ adapter, cancelCount }) => {
				const TestLive = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([adapter])),
					Layer.provideMerge(EngineLive)
				)
				return Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					yield* engine.dispatch(
						SessionCreateCommand.make({
							type: "session.create",
							commandId: CommandId.make("cmd-session"),
							sessionId,
							projectId,
							title: "Real provider session",
							providerId: fakeProviderId
						})
					)
					yield* engine.dispatch(
						TurnCancelCommand.make({
							type: "turn.cancel",
							commandId: CommandId.make("cmd-cancel"),
							sessionId
						})
					)
					const count = yield* waitUntil(Ref.get(cancelCount), (value) => value >= 1)
					Vitest.assert.strictEqual(count, 1)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(TestLive)
				)
			})
		)
	)

	Vitest.it.live("surfaces a dead adapter stream as ProviderSessionFailed", () => {
		const failingAdapter: ProviderAdapter = {
			providerId: fakeProviderId,
			capabilities: ProviderCapabilities.make({ enabled: [] }),
			presence: Effect.succeed({ providerId: fakeProviderId, installed: true, authenticated: true }),
			startSession: () =>
				Stream.fail(
					new ProviderAdapterError({
						providerId: fakeProviderId,
						operation: "startSession",
						detail: "subprocess crashed"
					})
				),
			sendPrompt: () => Stream.empty,
			cancelTurn: () => Effect.void
		}
		const TestLive = ProviderBridgeLive.pipe(
			Layer.provideMerge(ProviderAdapterRegistryLive([failingAdapter])),
			Layer.provideMerge(EngineLive)
		)
		return Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const store = yield* OrchestrationEventStore
			yield* engine.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("cmd-project"),
					projectId,
					title: "Acepe",
					workspaceRoot: "/tmp/acepe"
				})
			)
			yield* engine.dispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: CommandId.make("cmd-session"),
					sessionId,
					projectId,
					title: "Doomed session",
					providerId: fakeProviderId
				})
			)
			const events = yield* waitUntil(
				Stream.runCollect(store.readFrom(0, 50)),
				(collected) => collected.some((event) => event.type === "ProviderSessionFailed")
			)
			const failed = events.filter((event) => event.type === "ProviderSessionFailed")
			Vitest.assert.strictEqual(failed.length, 1)
			if (failed[0]?.type === "ProviderSessionFailed") {
				Vitest.assert.strictEqual(failed[0].payload.sessionId, sessionId)
				Vitest.assert.strictEqual(failed[0].payload.providerId, fakeProviderId)
				Vitest.assert.strictEqual(failed[0].payload.operation, "startSession")
			}
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(TestLive)
		)
	})

	Vitest.it.live("leaves sessions with no providerId to HardcodedProvider", () =>
		makeScriptedAdapter(fakeProviderId).pipe(
			Effect.flatMap(({ adapter, sendPromptCount }) => {
				const TestLive = Layer.mergeAll(
					ProviderBridgeLive,
					HardcodedProviderLive(Duration.zero)
				).pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([adapter])),
					Layer.provideMerge(EngineLive)
				)
				return Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const hardcoded = yield* HardcodedProvider
					const store = yield* OrchestrationEventStore
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					yield* engine.dispatch(
						SessionCreateCommand.make({
							type: "session.create",
							commandId: CommandId.make("cmd-session-tracer"),
							sessionId: tracerSessionId,
							projectId,
							title: "Tracer session"
						})
					)
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message-tracer"),
							sessionId: tracerSessionId,
							messageId: tracerMessageId,
							text: "Ping"
						})
					)
					yield* hardcoded.waitForReply(tracerMessageId)

					const events = yield* Stream.runCollect(store.readFrom(0, 50))
					const tokens = events.filter((event) => event.type === "TokenAppended")
					Vitest.assert.strictEqual(
						tokens.map((event) => (event.type === "TokenAppended" ? event.payload.token : "")).join(""),
						TRACER_REPLY_TEXT
					)
					// The fake adapter must never have been touched.
					const prompts = yield* Ref.get(sendPromptCount)
					Vitest.assert.strictEqual(prompts, 0)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(TestLive)
				)
			})
		)
	)

	// Reproduces a real QA boot failure: a completed real-provider session
	// already sits in the DB from a prior run. On the NEXT boot, the bridge's
	// startup replay walked every historical SessionCreated event and eagerly
	// re-called adapter.startSession -- spawning a brand-new provider session
	// and re-running the adapter's own event-id sequence from scratch. Since
	// an adapter's own eventIds are a deterministic function of
	// sessionId+sequence (see ClaudeAdapter.ts's `stamp`), replaying them
	// collided with the SAME ids already committed in the prior run, and the
	// store's UNIQUE(event_id) constraint rejected the append -- surfacing as
	// ProviderSessionFailed and leaving the resumed session unusable. A
	// session that isn't actively being used must not be re-spawned at boot;
	// it should only (re)open lazily, the next time it actually receives a
	// live command.
	Vitest.it.live(
		"boot replay does not re-spawn a completed real-provider session, and a follow-up still works",
		() =>
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const dir = yield* fs.makeTempDirectoryScoped()
				const dbFile = path.join(dir, "acepe-reboot-test.db")

				const SqliteAt = makeSqliteLayer({ filename: dbFile, readonly: false })
				const MigratedAt = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(SqliteAt))
				const PersistenceAt = Layer.mergeAll(
					OrchestrationEventStoreLive,
					OrchestrationCommandReceiptsLive
				).pipe(Layer.provideMerge(MigratedAt))
				const EngineAt = OrchestrationEngineLive.pipe(
					Layer.provideMerge(PersistenceAt),
					Layer.provide(BunCrypto.layer)
				)

				// PHASE 1 ("first boot"): create the project/session, send a
				// message, and let the adapter complete the turn -- exactly a
				// finished real-provider session sitting in the DB.
				const phase1 = yield* makeScriptedAdapter(fakeProviderId)
				const Phase1Live = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([phase1.adapter])),
					Layer.provideMerge(EngineAt)
				)
				yield* Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const store = yield* OrchestrationEventStore
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project-reboot"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					yield* engine.dispatch(
						SessionCreateCommand.make({
							type: "session.create",
							commandId: CommandId.make("cmd-session-reboot"),
							sessionId,
							projectId,
							title: "Real provider session",
							providerId: fakeProviderId
						})
					)
					yield* waitUntil(Ref.get(phase1.startSessionCount), (value) => value >= 1)
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message-reboot-1"),
							sessionId,
							messageId: userMessageId,
							text: "First turn"
						})
					)
					yield* Queue.offer(phase1.startEvents, scriptedToken(0, "Hi"))
					yield* Queue.offer(phase1.startEvents, scriptedTurnCompleted())
					yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 200)),
						(collected) => collected.some((event) => event.type === "TurnCompleted")
					)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(Phase1Live),
					Effect.scoped
				)

				// PHASE 2 ("reboot"): a brand-new ProviderBridge/engine layer stack
				// (fresh in-memory state, same on-disk store) -- this is what
				// actually re-runs the store's historical replay from sequence 0.
				const phase2 = yield* makeScriptedAdapter(fakeProviderId)
				const Phase2Live = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([phase2.adapter])),
					Layer.provideMerge(EngineAt)
				)
				yield* Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const store = yield* OrchestrationEventStore

					// Give the bridge's boot-time replay a moment to finish walking
					// history before asserting nothing was (re)spawned from it.
					yield* Effect.sleep(Duration.millis(100))
					Vitest.assert.strictEqual(yield* Ref.get(phase2.startSessionCount), 0)
					const afterBoot = yield* Stream.runCollect(store.readFrom(0, 200))
					Vitest.assert.isFalse(
						afterBoot.some((event) => event.type === "ProviderSessionFailed"),
						"boot replay must not fail the resumed session with a duplicate event_id"
					)

					// The resumed session must still accept a follow-up message --
					// lazily (re)opening the adapter session on demand.
					const followUpMessageId = MessageId.make("message-followup")
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message-reboot-2"),
							sessionId,
							messageId: followUpMessageId,
							text: "Follow-up after reboot"
						})
					)
					const started = yield* waitUntil(
						Ref.get(phase2.startSessionCount),
						(value) => value >= 1
					)
					Vitest.assert.strictEqual(started, 1)
					yield* Queue.offer(phase2.startEvents, scriptedToken(2, "Resumed"))

					const events = yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 200)),
						(collected) =>
							collected.some(
								(event) => event.type === "TokenAppended" && event.payload.token === "Resumed"
							)
					)
					Vitest.assert.isFalse(
						events.some((event) => event.type === "ProviderSessionFailed"),
						"the follow-up must not fail with a duplicate event_id either"
					)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(Phase2Live),
					Effect.scoped
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
			),
		{ timeout: 20_000 }
	)

	// Reproduces DEFECT C (minor): a spawned `claude` subprocess survived app
	// quit because nothing ever called the adapter's teardown path. The bridge
	// registers a finalizer on its own layerScope (shutdownAllAdapters) that
	// calls `shutdown` on every registered adapter that structurally exposes
	// one -- this locks in that the finalizer actually fires when the
	// bridge's layer scope closes, that an adapter with no shutdown is simply
	// skipped (HardcodedProvider-shaped adapters never had one), and that one
	// adapter's shutdown throwing does not stop another adapter's shutdown
	// from still running -- appendFailure's own "never wedge the caller"
	// contract, applied to teardown instead of event append.
	Vitest.it.live(
		"closing the bridge's scope calls shutdown on every adapter that exposes one, tolerating a failure",
		() =>
			Effect.gen(function*() {
				const shutdownCalls = yield* Ref.make(0)
				const shutdownAdapter: ProviderAdapter & { readonly shutdown: Effect.Effect<void> } = {
					providerId: fakeProviderId,
					capabilities: ProviderCapabilities.make({ enabled: [] }),
					presence: Effect.succeed({ providerId: fakeProviderId, installed: true, authenticated: true }),
					startSession: () => Stream.empty,
					sendPrompt: () => Stream.empty,
					cancelTurn: () => Effect.void,
					shutdown: Ref.update(shutdownCalls, (count) => count + 1).pipe(Effect.asVoid)
				}
				const failingProviderId = ProviderId.make("fake-provider-failing-shutdown")
				const failingShutdownCalls = yield* Ref.make(0)
				const failingShutdownAdapter: ProviderAdapter & { readonly shutdown: Effect.Effect<void> } = {
					providerId: failingProviderId,
					capabilities: ProviderCapabilities.make({ enabled: [] }),
					presence: Effect.succeed({
						providerId: failingProviderId,
						installed: true,
						authenticated: true
					}),
					startSession: () => Stream.empty,
					sendPrompt: () => Stream.empty,
					cancelTurn: () => Effect.void,
					shutdown: Ref.update(failingShutdownCalls, (count) => count + 1).pipe(
						Effect.andThen(Effect.die("shutdown boom"))
					)
				}
				// makeScriptedAdapter's own adapter has no `shutdown` at all --
				// exactly like HardcodedProvider's adapters today -- so it doubles
				// as proof that supportsShutdown's structural check skips it
				// cleanly instead of erroring on a missing method.
				const noShutdown = yield* makeScriptedAdapter(ProviderId.make("fake-provider-no-shutdown"))

				const TestLive = ProviderBridgeLive.pipe(
					Layer.provideMerge(
						ProviderAdapterRegistryLive([shutdownAdapter, failingShutdownAdapter, noShutdown.adapter])
					),
					Layer.provideMerge(EngineLive)
				)
				yield* Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					// Touching the engine is enough to prove the bridge itself is up
					// and running before its scope closes -- shutdownAllAdapters
					// walks every REGISTERED adapter regardless of whether any
					// session ever used it, so no session.create is needed here.
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project-shutdown"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					Vitest.assert.strictEqual(yield* Ref.get(shutdownCalls), 0)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(TestLive),
					Effect.scoped
				)

				Vitest.assert.strictEqual(
					yield* Ref.get(shutdownCalls),
					1,
					"the healthy adapter's shutdown must run when the bridge's scope closes"
				)
				Vitest.assert.strictEqual(
					yield* Ref.get(failingShutdownCalls),
					1,
					"a failing adapter's shutdown must still be attempted, not skipped"
				)
			})
	)

	// Reproduces DEFECT D's RESIDUAL bug, found live: the boot-replay fix
	// (ea0ab5705) stops eager re-spawn on every historical SessionCreated, but
	// a session's FIRST *lazy* reopen after a genuine app restart still built a
	// brand new ClaudeAdapter SessionRuntime whose own `sequence` counter (see
	// ClaudeAdapter.ts's stamp()) restarted at 0 -- re-deriving the SAME
	// eventIds (sessionId:1, sessionId:2, ...) the PRIOR process already
	// committed for that session's real conversation. That still trips the
	// store's UNIQUE(event_id) constraint on the very first post-restart
	// event, appends a ProviderSessionFailed, AND -- this is the part the
	// scripted-adapter D test above cannot see, because its fake adapter's
	// eventIds are message-scoped and can't collide -- leaves the session
	// silently poisoned: a SECOND follow-up right after the failure produced a
	// live MessageSent with no ProviderSessionFailed, no TokenAppended, no
	// TurnCompleted, ever. This drives two REAL ClaudeAdapter instances
	// (openSession never eagerly re-spawns; the second is what a genuine
	// process restart looks like) against the same on-disk store, with a
	// scripted `createQuery` standing in for the real SDK.
	Vitest.it.live(
		"a real ClaudeAdapter's lazy reopen after restart does not collide with its own prior eventIds",
		() =>
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const dir = yield* fs.makeTempDirectoryScoped()
				const dbFile = path.join(dir, "acepe-claude-reboot-test.db")
				const claudeSessionId = SessionId.make("session-claude-reboot")
				const claudeProviderId = ProviderId.make("claude-code")

				const SqliteAt = makeSqliteLayer({ filename: dbFile, readonly: false })
				const MigratedAt = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(SqliteAt))
				const PersistenceAt = Layer.mergeAll(
					OrchestrationEventStoreLive,
					OrchestrationCommandReceiptsLive
				).pipe(Layer.provideMerge(MigratedAt))
				const EngineAt = OrchestrationEngineLive.pipe(
					Layer.provideMerge(PersistenceAt),
					Layer.provide(BunCrypto.layer)
				)

				// A minimal scripted createQuery: fresh inbound queue per call (like
				// the real SDK's query()), immediately streams one token then a
				// result message so the turn actually completes without the test
				// needing to drive it token-by-token.
				const makeScriptedCreateQuery = (token: string) =>
					(_input: unknown) =>
						Effect.gen(function*() {
							const inbound = yield* Queue.unbounded<Json, Done>()
							yield* Queue.offer(inbound, {
								type: "stream_event",
								session_id: "sdk-claude-reboot",
								event: {
									type: "content_block_delta",
									delta: { type: "text_delta", text: token }
								}
							})
							yield* Queue.offer(inbound, {
								type: "result",
								session_id: "sdk-claude-reboot",
								is_error: false,
								usage: { input_tokens: 1, output_tokens: 1 }
							})
							return {
								messages: Stream.fromQueue(inbound),
								interrupt: Effect.void,
								close: Queue.end(inbound).pipe(Effect.asVoid)
							} satisfies ClaudeQueryHandle
						})

				// PHASE 1 ("first boot"): a real ClaudeAdapter, a real turn, real
				// ClaudeAdapter-stamped eventIds committed to the on-disk store.
				const adapter1 = yield* makeClaudeAdapter({
					presence: Effect.succeed(claudePresence(true, true)),
					createQuery: makeScriptedCreateQuery("BEFORE_RESTART")
				})
				const Phase1Live = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([adapter1])),
					Layer.provideMerge(EngineAt)
				)
				yield* Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const store = yield* OrchestrationEventStore
					yield* engine.dispatch(
						ProjectCreateCommand.make({
							type: "project.create",
							commandId: CommandId.make("cmd-project-claude-reboot"),
							projectId,
							title: "Acepe",
							workspaceRoot: "/tmp/acepe"
						})
					)
					yield* engine.dispatch(
						SessionCreateCommand.make({
							type: "session.create",
							commandId: CommandId.make("cmd-session-claude-reboot"),
							sessionId: claudeSessionId,
							projectId,
							title: "Real Claude session",
							providerId: claudeProviderId
						})
					)
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message-claude-reboot-1"),
							sessionId: claudeSessionId,
							messageId: userMessageId,
							text: "First turn before restart"
						})
					)
					yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 200)),
						(collected) => collected.some((event) => event.type === "TurnCompleted")
					)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(Phase1Live),
					Effect.scoped
				)

				// A real restart takes measurable wall-clock time; a small sleep
				// keeps this deterministic rather than relying on incidental test
				// overhead to separate the two ClaudeAdapter instances' openEpochMs.
				yield* Effect.sleep(Duration.millis(5))

				// PHASE 2 ("reboot"): a BRAND NEW ClaudeAdapter instance (fresh
				// `sessions` map, fresh per-runtime sequence counters) -- exactly
				// what a real process restart produces -- reused against the SAME
				// on-disk store. The lazy reopen this triggers must not collide with
				// phase 1's already-committed eventIds, and the session must not be
				// left poisoned: a SECOND follow-up must also complete.
				const adapter2 = yield* makeClaudeAdapter({
					presence: Effect.succeed(claudePresence(true, true)),
					createQuery: makeScriptedCreateQuery("AFTER_RESTART")
				})
				const Phase2Live = ProviderBridgeLive.pipe(
					Layer.provideMerge(ProviderAdapterRegistryLive([adapter2])),
					Layer.provideMerge(EngineAt)
				)
				yield* Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const store = yield* OrchestrationEventStore

					const followUpMessageId = MessageId.make("message-claude-reboot-followup")
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message-claude-reboot-2"),
							sessionId: claudeSessionId,
							messageId: followUpMessageId,
							text: "Follow-up after restart"
						})
					)

					const afterFirstFollowUp = yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 200)),
						(collected) =>
							collected.some((event) => event.type === "TurnCompleted") ||
							collected.some((event) => event.type === "ProviderSessionFailed")
					)
					Vitest.assert.isFalse(
						afterFirstFollowUp.some((event) => event.type === "ProviderSessionFailed"),
						"a lazy reopen after restart must not collide with the prior process's own eventIds"
					)
					Vitest.assert.isTrue(
						afterFirstFollowUp.some((event) => event.type === "TurnCompleted"),
						"the post-restart follow-up must actually complete"
					)

					// The session must not be left poisoned by any residual bad state
					// -- a SECOND follow-up on the same lazily-reopened runtime must
					// also complete cleanly.
					const secondFollowUpMessageId = MessageId.make("message-claude-reboot-followup-2")
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-message-claude-reboot-3"),
							sessionId: claudeSessionId,
							messageId: secondFollowUpMessageId,
							text: "Second follow-up after restart"
						})
					)
					const afterSecondFollowUp = yield* waitUntil(
						Stream.runCollect(store.readFrom(0, 200)),
						(collected) =>
							collected.filter((event) => event.type === "TurnCompleted").length >= 2
					)
					Vitest.assert.isFalse(
						afterSecondFollowUp.some((event) => event.type === "ProviderSessionFailed"),
						"a second follow-up on the reopened session must not fail either"
					)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(Phase2Live),
					Effect.scoped
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
			),
		{ timeout: 20_000 }
	)
})
