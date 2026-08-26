// Issue #268 (BLOCKER, defect 1): sessions imported from provider history
// dispatched session.create with no providerId, so projection_sessions
// .provider stayed NULL and HardcodedProvider (the tracer) claimed the
// session -- the owner's real Claude Code history answered with the
// tracer's canned "Hello from Acepe." instead of the model. This is the
// real seam the bug lived at: importProviderSessionHandler (the RPC handler
// desktop's history.ts actually calls) driving the real discovery scan and
// the real ClaudeHistory importer against an on-disk fixture, not a
// synthetic SessionCreateCommand with providerId already filled in by hand.
import {
	CommandId,
	MessageId,
	MessageSendCommand,
	ProjectId,
	SessionId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import { pathToSlug } from "../history/discovery/Roots.ts"
import { ProviderSessionDiscovery, ProviderSessionDiscoveryLive } from "../history/discovery/ProviderSessionDiscovery.ts"
import { ClaudeHistory } from "../history/Services/ClaudeHistory.ts"
import { ClaudeHistoryLive } from "../history/Layers/ClaudeHistory.ts"
import { OrchestrationCommandReceiptsLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../persistence/Migrations.ts"
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { ProjectionProjectsLive } from "../persistence/Layers/ProjectionProjects.ts"
import { ProjectionSessionMessagesLive } from "../persistence/Layers/ProjectionSessionMessages.ts"
import { ProjectionSessionsLive } from "../persistence/Layers/ProjectionSessions.ts"
import { ProjectionStateLive } from "../persistence/Layers/ProjectionState.ts"
import { ProjectionSessions } from "../persistence/Services/ProjectionSessions.ts"
import { ProjectionProjects } from "../persistence/Services/ProjectionProjects.ts"
import { HardcodedProvider, HardcodedProviderLive } from "../provider/HardcodedProvider.ts"
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

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionProjectsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineAndStore = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

// ClaudeHistoryLive's own importSessionFile/importDirectory write through
// these projectors directly (see handlers.test.ts's identical comment) --
// same MigratedSqlite instance as PersistenceLive so both hit the one test
// database.
const ClaudeHistoryProjectionsLive = Layer.mergeAll(
	ProjectionSessionsLive,
	ProjectionSessionMessagesLive,
	ProjectionStateLive
).pipe(Layer.provideMerge(MigratedSqlite))

const ClaudeHistoryTestLive = ClaudeHistoryLive.pipe(
	Layer.provide(Platform),
	Layer.provide(ProjectionSnapshotQueryLive),
	Layer.provide(EngineAndStore),
	Layer.provide(ClaudeHistoryProjectionsLive)
)

const HardcodedProviderTestLive = HardcodedProviderLive(Duration.zero).pipe(
	Layer.provideMerge(EngineAndStore)
)

const TestLive = Layer.mergeAll(
	ClaudeHistoryTestLive,
	HardcodedProviderTestLive,
	ClaudeHistoryProjectionsLive,
	Platform
)

const isolated = () => Layer.fresh(TestLive)

// Mirrors ProviderSessionDiscovery.test.ts's own pattern: discovery resolves
// its Claude projects root (HOME/.claude/projects) once at layer
// construction, so a fixture-backed test provides that layer inline, in the
// test body, once it knows the scoped temp homeDir -- not at group level,
// where no test-specific temp dir exists yet.
const discoveryLayerFor = (homeDir: string) =>
	ProviderSessionDiscoveryLive.pipe(
		Layer.provide(Platform),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: homeDir } })))
	)

const claudeLine = (fields: Record<string, unknown>): string => JSON.stringify(fields)

const writeFixtureSession = Effect.fn("writeFixtureSession")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
	projectPath: string,
	fixtureSessionId: string,
	userText: string
) {
	const projectDir = path.join(homeDir, ".claude", "projects", pathToSlug(projectPath))
	yield* fs.makeDirectory(projectDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(projectDir, `${fixtureSessionId}.jsonl`),
		claudeLine({
			type: "user",
			sessionId: fixtureSessionId,
			message: { role: "user", content: userText }
		})
	)
})

Vitest.layer(isolated())("importProviderSessionHandler (#268 defect 1)", (it) => {
	it.effect(
		"imports a discovered Claude session, persists its real providerId, and the tracer never answers it",
		() =>
			Effect.gen(function*() {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const homeDir = yield* fs.makeTempDirectoryScoped()
				const projectPath = "/Users/owner/acme-app"
				const fixtureSessionId = "c1efdaca-fixture-session"
				yield* writeFixtureSession(fs, path, homeDir, projectPath, fixtureSessionId, "Hi Claude")

				const discovery = yield* ProviderSessionDiscovery.pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(discoveryLayerFor(homeDir))
				)
				const claudeHistory = yield* ClaudeHistory
				const projects = yield* ProjectionProjects
				const sessions = yield* ProjectionSessions
				const engine = yield* OrchestrationEngine
				const store = yield* OrchestrationEventStore
				const provider = yield* HardcodedProvider

				const result = yield* importProviderSessionHandler(discovery, claudeHistory, projects, {
					provider: "claude",
					projectPath,
					sessionId: fixtureSessionId
				})
				Vitest.assert.strictEqual(result.imported, true)
				const importedSessionId = SessionId.make(result.sessionId)

				// Defect 1a: the imported session's providerId must be the real
				// adapter's id, not left undefined (which projects to a NULL
				// provider column and lets the tracer claim it).
				const persisted = yield* sessions.get(importedSessionId)
				Vitest.assert.isTrue(Option.isSome(persisted))
				if (Option.isSome(persisted)) {
					Vitest.assert.strictEqual(persisted.value.provider, "claude-code")
				}

				// Defect 1b (claim-side hardening): even with the real providerId
				// now persisted, prove the tracer does not race a canned reply
				// onto this session -- send a message and confirm no
				// TokenAppended ever appears for the tracer's own assistant id.
				const userMessageId = MessageId.make("message-owner-turn")
				yield* engine.dispatch(
					MessageSendCommand.make({
						type: "message.send",
						commandId: CommandId.make("cmd-owner-turn"),
						sessionId: importedSessionId,
						messageId: userMessageId,
						text: "What does this file do?"
					})
				)
				yield* provider.idle
				const events = yield* Stream.runCollect(store.readFrom(0, 50))
				const tracerAssistantId = tracerAssistantMessageId(userMessageId)
				const tracerTokens = events.filter(
					(event) => event.type === "TokenAppended" && event.payload.messageId === tracerAssistantId
				)
				Vitest.assert.strictEqual(tracerTokens.length, 0)
			})
	)

	it.effect("reports imported:false when discovery finds no matching session", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const discovery = yield* ProviderSessionDiscovery.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(discoveryLayerFor(homeDir))
			)
			const claudeHistory = yield* ClaudeHistory
			const projects = yield* ProjectionProjects
			const result = yield* importProviderSessionHandler(discovery, claudeHistory, projects, {
				provider: "claude",
				projectPath: "/Users/owner/no-such-project",
				sessionId: "missing-session"
			})
			Vitest.assert.strictEqual(result.imported, false)
		}))
})
