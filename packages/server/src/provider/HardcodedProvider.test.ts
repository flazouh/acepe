import {
	CommandId,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId,
	TRACER_REPLY_TEXT
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import { OrchestrationCommandReceiptsLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../persistence/Migrations.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { HardcodedProvider, HardcodedProviderLive } from "./HardcodedProvider.ts"

const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const userMessageId = MessageId.make("message-user")

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

const TestLive = HardcodedProviderLive(Duration.zero).pipe(Layer.provideMerge(EngineLive))

const isolated = () => Layer.fresh(TestLive)

Vitest.layer(isolated())("hard-coded provider", (it) => {
	it.effect("streams tracer tokens as TokenAppended events after message.send", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const provider = yield* HardcodedProvider
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
					title: "First session"
				})
			)
			yield* engine.dispatch(
				MessageSendCommand.make({
					type: "message.send",
					commandId: CommandId.make("cmd-message"),
					sessionId,
					messageId: userMessageId,
					text: "Ping"
				})
			)
			yield* provider.waitForReply(userMessageId)
			const events = yield* Stream.runCollect(store.readFrom(0, 20))
			const tokens = events.filter((event) => event.type === "TokenAppended")
			Vitest.assert.strictEqual(tokens.length, 3)
			Vitest.assert.deepStrictEqual(
				tokens.map((event) => (event.type === "TokenAppended" ? event.payload.token : "")),
				["Hello", " from", " Acepe."]
			)
			Vitest.assert.strictEqual(
				tokens
					.map((event) => (event.type === "TokenAppended" ? event.payload.token : ""))
					.join(""),
				TRACER_REPLY_TEXT
			)
		})
	)
})
