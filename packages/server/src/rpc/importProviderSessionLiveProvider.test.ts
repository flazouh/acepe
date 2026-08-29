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
import {
	SessionId
} from "@acepe/contracts"
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

Vitest.describe("history import vs the live provider (transcript duplication, defect 2)", () => {
	Vitest.it.live(
		"never opens a provider session or re-sends a historical prompt",
		() =>
			makeCountingAdapter().pipe(
				Effect.flatMap(({ adapter, startSessionCount, sendPromptCount }) => {
					const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(
						Layer.provideMerge(TempSqlite)
					)
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
					const TestLive = Layer.mergeAll(
						ProviderBridgeLive.pipe(
							Layer.provideMerge(ProviderAdapterRegistryLive([adapter])),
							Layer.provideMerge(EngineLive)
						),
						ClaudeHistoryTestLive,
						Projections,
						EngineLive,
						Platform
					)
					return Effect.gen(function*() {
						const fs = yield* FileSystem.FileSystem
						const path = yield* Path.Path
						const homeDir = yield* fs.makeTempDirectoryScoped()
						// A REAL directory: openSession refuses to touch an
						// adapter when the project's workspaceRoot is missing
						// from disk, which would hide the defect behind a
						// check that has nothing to do with it.
						// realPath, not the raw temp path: discovery slugs the
						// realpath (macOS /var -> /private/var), so a fixture
						// written under the raw spelling is never found.
						const projectPath = yield* fs.realPath(
							yield* fs.makeTempDirectoryScoped()
						)
						const fixtureSessionId = "286997f1-fixture-session"
						yield* writeFixtureSession(fs, path, homeDir, projectPath, fixtureSessionId)

						const discovery = yield* ProviderSessionDiscovery.pipe(
							// @effect-diagnostics-next-line strictEffectProvide:off
							Effect.provide(discoveryLayerFor(homeDir))
						)
						const claudeHistory = yield* ClaudeHistory
						const projects = yield* ProjectionProjects
						const store = yield* OrchestrationEventStore

						const result = yield* importProviderSessionHandler(
							discovery,
							claudeHistory,
							projects,
							{
								provider: "claude",
								projectPath,
								sessionId: fixtureSessionId
							}
						)
						Vitest.assert.strictEqual(result.imported, true)
						const importedSessionId = SessionId.make(result.sessionId)

						// The bridge reacts on its own fiber; give it real time
						// to do the wrong thing before claiming it did not.
						yield* Effect.sleep(Duration.millis(300))

						const opened = yield* Ref.get(startSessionCount)
						const prompted = yield* Ref.get(sendPromptCount)
						Vitest.assert.deepStrictEqual(
							{ opened, prompted },
							{ opened: 0, prompted: 0 }
						)

						// And the import itself must still have landed, so the
						// two counts above cannot pass by importing nothing.
						const events = yield* Stream.runCollect(store.readFrom(0, 100))
						const assistantRows = events.filter(
							(event) =>
								event.type === "TokenAppended" &&
								event.payload.sessionId === importedSessionId
						)
						Vitest.assert.strictEqual(assistantRows.length, 1)
					}).pipe(Effect.provide(TestLive))
				})
			)
	)
})
