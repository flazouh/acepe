import {
	CommandId,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId,
	tracerAssistantMessageId,
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
const realProviderSessionId = SessionId.make("session-real")
const realProviderMessageId = MessageId.make("message-real")
const tracerSessionId = SessionId.make("session-tracer")
const tracerMessageId = MessageId.make("message-tracer")

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

	// Regression: HardcodedProvider used to react to every MessageSent event
	// with no regard for providerId, so a real-provider session's own reply
	// (from ProviderBridge.ts, a real adapter) raced the tracer's canned one
	// and the tracer sometimes won — a real Claude session showing "Hello
	// from Acepe." instead of the model's actual reply. HardcodedProvider
	// must now skip any session whose SessionCreated carried a providerId.
	it.effect("does not reply to a session created with a real providerId", () =>
		Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			const provider = yield* HardcodedProvider
			const store = yield* OrchestrationEventStore
			const secondProjectId = ProjectId.make("project-2")
			yield* engine.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("cmd-project-2"),
					projectId: secondProjectId,
					title: "Acepe (real provider)",
					workspaceRoot: "/tmp/acepe-real-provider"
				})
			)
			yield* engine.dispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: CommandId.make("cmd-session-real"),
					sessionId: realProviderSessionId,
					projectId: secondProjectId,
					title: "Real provider session",
					providerId: "claude-code"
				})
			)
			yield* engine.dispatch(
				MessageSendCommand.make({
					type: "message.send",
					commandId: CommandId.make("cmd-message-real"),
					sessionId: realProviderSessionId,
					messageId: realProviderMessageId,
					text: "Ping"
				})
			)
			// Give the tracer a normal session to reply to and wait for THAT
			// reply: consider() processes events strictly in order, on one
			// fiber, so by the time this resolves the tracer has already
			// either claimed or skipped the real-provider session's message
			// above — no sleep-based polling needed.
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
			yield* provider.waitForReply(tracerMessageId)

			const events = yield* Stream.runCollect(store.readFrom(0, 50))
			const realProviderAssistantId = tracerAssistantMessageId(realProviderMessageId)
			const realProviderTokens = events.filter(
				(event) => event.type === "TokenAppended" && event.payload.messageId === realProviderAssistantId
			)
			Vitest.assert.strictEqual(realProviderTokens.length, 0)

			const tracerTokens = events.filter(
				(event) =>
					event.type === "TokenAppended" &&
					event.payload.messageId === tracerAssistantMessageId(tracerMessageId)
			)
			Vitest.assert.strictEqual(tracerTokens.length, 3)
		})
	)
})
