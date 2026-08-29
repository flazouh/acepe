// Transcript duplication, defect 2: the history importer dispatches real
// `session.create`/`message.send` COMMANDS through the OrchestrationEngine,
// and ProviderBridge reads every live domain event as an intent -- so
// importing a Claude session opened a real provider session and re-sent
// every historical user message to the model. The model then answered, and
// its assistant tokens landed in the same session next to the importer's
// replayed ones (live database, session 286997f1: sequence 1722 carries the
// importer's `...:assistant:0` row and 1724/1725 the adapter's
// `...:user:0:assistant` row, three sequences apart).
//
// Two producers, one canonical transcript. This test drives the same seam
// desktop calls (importProviderSessionHandler) with a live ProviderBridge
// behind it and a scripted adapter registered under the real Claude provider
// id, and asserts the import never reaches the adapter.
import { CommandId, MessageId, MessageSendCommand, SessionId } from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { ClaudeHistoryLive } from "../history/Layers/ClaudeHistory.ts"
import { ClaudeHistory } from "../history/Services/ClaudeHistory.ts"
import {
	ProviderSessionDiscovery,
	ProviderSessionDiscoveryLive
} from "../history/discovery/ProviderSessionDiscovery.ts"
import { pathToSlug } from "../history/discovery/Roots.ts"
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts"
import { OrchestrationCommandReceiptsLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts"
import { ProjectionProjectsLive } from "../persistence/Layers/ProjectionProjects.ts"
import { ProjectionSessionMessagesLive } from "../persistence/Layers/ProjectionSessionMessages.ts"
import { ProjectionSessionsLive } from "../persistence/Layers/ProjectionSessions.ts"
import { ProjectionStateLive } from "../persistence/Layers/ProjectionState.ts"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../persistence/Migrations.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { ProjectionProjects } from "../persistence/Services/ProjectionProjects.ts"
import { CLAUDE_PROVIDER_ID } from "../provider/Layers/Claude/Provider.ts"
import { ProviderAdapterRegistryLive } from "../provider/Layers/ProviderAdapterRegistry.ts"
import { ProviderBridgeLive } from "../provider/Layers/ProviderBridge.ts"
import {
	type ProviderAdapter,
	ProviderCapabilities,
	ProviderId
} from "../provider/Services/ProviderAdapter.ts"
import { importProviderSessionHandler } from "./handlers.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

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
).pipe(Layer.provide(Platform))

const claudeProviderId = ProviderId.make(CLAUDE_PROVIDER_ID)

// ProviderBridge has no public waitFor hook (see ProviderBridge.test.ts's
// identical helper), so a test polls for the shape it expects instead of
// sleeping a fixed time.
const waitUntil = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	predicate: (value: A) => boolean,
	attempts = 200
): Effect.Effect<A, E, R> =>
	Effect.gen(function*() {
		let last = yield* effect
		let remaining = attempts
		while (predicate(last) === false && remaining > 0) {
			yield* Effect.sleep(Duration.millis(10))
			last = yield* effect
			remaining -= 1
		}
		return last
	})

// Counts the two calls that prove the bridge treated an imported history
// fact as a live intent: startSession (spawns the provider) and sendPrompt
// (re-asks the model). Its startSession stream is queue-backed and never
// fed, so an opened session stays open for the whole test instead of the
// forwarding fiber ending at once.
const makeCountingAdapter = Effect.fn("makeCountingAdapter")(function*() {
	const startEvents = yield* Queue.unbounded<
		import("@acepe/contracts").OrchestrationEvent,
		Done
	>()
	const startSessionCount = yield* Ref.make(0)
	const sendPromptCount = yield* Ref.make(0)
	const adapter: ProviderAdapter = {
		providerId: claudeProviderId,
		capabilities: ProviderCapabilities.make({ enabled: [] }),
		presence: Effect.succeed({
			providerId: claudeProviderId,
			installed: true,
			authenticated: true
		}),
		startSession: () =>
			Stream.unwrap(
				Ref.update(startSessionCount, (count) => count + 1).pipe(
					Effect.as(Stream.fromQueue(startEvents))
				)
			),
		sendPrompt: () =>
			Stream.unwrap(
				Ref.update(sendPromptCount, (count) => count + 1).pipe(Effect.as(Stream.empty))
			),
		cancelTurn: () => Effect.void
	}
	return { adapter, startSessionCount, sendPromptCount }
})

const discoveryLayerFor = (homeDir: string) =>
	ProviderSessionDiscoveryLive.pipe(
		Layer.provide(Platform),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: homeDir } })))
	)

const claudeLine = (fields: Record<string, unknown>): string => JSON.stringify(fields)

// A two-line transcript: one user prompt and the assistant answer it already
// received. Both are history -- neither is anything to ask the model again.
const writeFixtureSession = Effect.fn("writeFixtureSession")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
	projectPath: string,
	fixtureSessionId: string
) {
	const projectDir = path.join(homeDir, ".claude", "projects", pathToSlug(projectPath))
	yield* fs.makeDirectory(projectDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(projectDir, `${fixtureSessionId}.jsonl`),
		[
			claudeLine({
				type: "user",
				sessionId: fixtureSessionId,
				message: { role: "user", content: "Run all three steps." }
			}),
			claudeLine({
				type: "assistant",
				sessionId: fixtureSessionId,
				message: { role: "assistant", content: "I'll run all three steps." }
			})
		].join("\n")
	)
})

// One stack over one temp database: the real engine, the real Claude history
// importer, and a live ProviderBridge whose only registered adapter is the
// counting one above.
const testLayerFor = (adapter: ProviderAdapter) => {
	const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))
	const Projections = Layer.mergeAll(
		ProjectionSessionsLive,
		ProjectionSessionMessagesLive,
		ProjectionStateLive,
		ProjectionProjectsLive
	).pipe(Layer.provideMerge(MigratedSqlite))
	const PersistenceLive = Layer.mergeAll(
		OrchestrationEventStoreLive,
		OrchestrationCommandReceiptsLive
	).pipe(Layer.provideMerge(MigratedSqlite))
	const EngineLive = OrchestrationEngineLive.pipe(
		Layer.provideMerge(PersistenceLive),
		Layer.provide(BunCrypto.layer)
	)
	const ClaudeHistoryTestLive = ClaudeHistoryLive.pipe(
		Layer.provide(Platform),
		Layer.provide(ProjectionSnapshotQueryLive),
		Layer.provide(EngineLive),
		Layer.provide(Projections)
	)
	return Layer.mergeAll(
		ProviderBridgeLive.pipe(
			Layer.provideMerge(ProviderAdapterRegistryLive([adapter])),
			Layer.provideMerge(EngineLive)
		),
		ClaudeHistoryTestLive,
		Projections,
		EngineLive,
		Platform
	)
}

// Writes the fixture, imports it through the same handler desktop calls, and
// hands the test the imported session id.
const importFixtureSession = Effect.fn("importFixtureSession")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const homeDir = yield* fs.makeTempDirectoryScoped()
	// realPath, not the raw temp path: discovery slugs the realpath (macOS
	// /var -> /private/var), so a fixture written under the raw spelling is
	// never found. A REAL directory besides: openSession refuses to touch an
	// adapter when the project's workspaceRoot is missing from disk, which
	// would hide the defect behind a check that has nothing to do with it.
	const projectPath = yield* fs.realPath(yield* fs.makeTempDirectoryScoped())
	const fixtureSessionId = "286997f1-fixture-session"
	yield* writeFixtureSession(fs, path, homeDir, projectPath, fixtureSessionId)

	const discovery = yield* ProviderSessionDiscovery.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(discoveryLayerFor(homeDir))
	)
	const claudeHistory = yield* ClaudeHistory
	const projects = yield* ProjectionProjects
	const result = yield* importProviderSessionHandler(discovery, claudeHistory, projects, {
		provider: "claude",
		projectPath,
		sessionId: fixtureSessionId
	})
	Vitest.assert.strictEqual(result.imported, true)
	return SessionId.make(result.sessionId)
})

Vitest.describe("history import vs the live provider (transcript duplication, defect 2)", () => {
	Vitest.it.live("never opens a provider session or re-sends a historical prompt", () =>
		makeCountingAdapter().pipe(
			Effect.flatMap(({ adapter, startSessionCount, sendPromptCount }) =>
				Effect.gen(function*() {
					const store = yield* OrchestrationEventStore
					const importedSessionId = yield* importFixtureSession()

					// The bridge reacts on its own fiber; give it real time to
					// do the wrong thing before claiming it did not.
					yield* Effect.sleep(Duration.millis(300))

					const opened = yield* Ref.get(startSessionCount)
					const prompted = yield* Ref.get(sendPromptCount)
					Vitest.assert.deepStrictEqual({ opened, prompted }, { opened: 0, prompted: 0 })

					// And the import itself must still have landed, so the two
					// counts above cannot pass by importing nothing.
					const events = yield* Stream.runCollect(store.readFrom(0, 100))
					const assistantRows = events.filter(
						(event) =>
							event.type === "TokenAppended" &&
							event.payload.sessionId === importedSessionId
					)
					Vitest.assert.strictEqual(assistantRows.length, 1)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(testLayerFor(adapter))
				)
			)
		))

	// The other half of the claim: skipping the import must not strand the
	// session. The moment the owner actually types into it, the bridge opens
	// the provider lazily and sends that one prompt -- and only that one.
	Vitest.it.live("still opens the session lazily when a live message arrives", () =>
		makeCountingAdapter().pipe(
			Effect.flatMap(({ adapter, startSessionCount, sendPromptCount }) =>
				Effect.gen(function*() {
					const engine = yield* OrchestrationEngine
					const importedSessionId = yield* importFixtureSession()
					yield* Effect.sleep(Duration.millis(100))
					Vitest.assert.strictEqual(yield* Ref.get(startSessionCount), 0)

					const liveMessageId = MessageId.make(`${importedSessionId}:live-turn`)
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId: CommandId.make("cmd-live-turn"),
							sessionId: importedSessionId,
							messageId: liveMessageId,
							text: "Now do the fourth step."
						})
					)
					const prompted = yield* waitUntil(
						Ref.get(sendPromptCount),
						(count) => count >= 1
					)
					Vitest.assert.strictEqual(prompted, 1)
					Vitest.assert.strictEqual(yield* Ref.get(startSessionCount), 1)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(testLayerFor(adapter))
				)
			)
		))
})
