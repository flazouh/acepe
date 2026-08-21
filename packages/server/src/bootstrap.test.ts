import {
	AcepeRpc,
	CommandId,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId,
	TokenAppendCommand,
	TRACER_REPLY_TEXT,
	TRACER_REPLY_TOKENS,
	tracerAssistantMessageId,
	tracerTokenCommandId
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as RpcTest from "effect/unstable/rpc/RpcTest"
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts"
import { OrchestrationEngine } from "./orchestration/Services/OrchestrationEngine.ts"
import { HardcodedProvider } from "./provider/HardcodedProvider.ts"
import { acepeTestLive, acepeEngineLive, makeAcepeLive } from "./bootstrap.ts"

const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const userMessageId = MessageId.make("message-user")

const createProject = ProjectCreateCommand.make({
	type: "project.create",
	commandId: CommandId.make("cmd-project"),
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

const createSession = SessionCreateCommand.make({
	type: "session.create",
	commandId: CommandId.make("cmd-session"),
	sessionId,
	projectId,
	title: "First session"
})

const sendMessage = MessageSendCommand.make({
	type: "message.send",
	commandId: CommandId.make("cmd-message"),
	sessionId,
	messageId: userMessageId,
	text: "Ping"
})

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const waitForAssistant = Effect.fn("waitForAssistant")(function*() {
	const snapshots = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* snapshots.snapshot(sessionId)
		const assistant = Arr.findFirst(
			snapshot.messages,
			(row) => row.rowType === "assistant"
		)
		if (
			Option.isSome(assistant) &&
			assistant.value.rowType === "assistant" &&
			assistant.value.content.text === TRACER_REPLY_TEXT
		) {
			return snapshot
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return yield* snapshots.snapshot(sessionId)
})

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(isolated())("tracer bullet rpc path", (it) => {
	it.effect("projects a user row and concatenated assistant reply", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const provider = yield* HardcodedProvider
			yield* client.dispatch(createProject)
			yield* client.dispatch(createSession)
			yield* client.dispatch(sendMessage)
			yield* provider.waitForReply(userMessageId)
			const snapshot = yield* waitForAssistant()
			const rowTypes = Arr.map(snapshot.messages, (row) => row.rowType)
			Vitest.assert.deepStrictEqual(rowTypes, ["user", "assistant"])
			const user = snapshot.messages[0]
			const assistant = snapshot.messages[1]
			Vitest.assert.strictEqual(user?.rowType, "user")
			Vitest.assert.strictEqual(assistant?.rowType, "assistant")
			if (user?.rowType === "user") {
				Vitest.assert.strictEqual(user.content.text, "Ping")
			}
			if (assistant?.rowType === "assistant") {
				Vitest.assert.strictEqual(assistant.content.text, TRACER_REPLY_TEXT)
				Vitest.assert.strictEqual(assistant.sequence, 4)
			}
		})
	)

	it.effect("streams TokenAppended events in sequence order", () =>
		Effect.gen(function*() {
			const client = yield* RpcTest.makeClient(AcepeRpc)
			const provider = yield* HardcodedProvider
			yield* client.dispatch(createProject)
			yield* client.dispatch(createSession)
			const fiber = yield* client.events({ fromSequence: 0 }).pipe(
				Stream.filter((event) => event.type === "TokenAppended"),
				Stream.take(3),
				Stream.runCollect,
				Effect.forkScoped
			)
			yield* TestClock.adjust(Duration.millis(50))
			yield* client.dispatch(sendMessage)
			yield* provider.waitForReply(userMessageId)
			const tokens = yield* Fiber.join(fiber)
			Vitest.assert.strictEqual(tokens.length, 3)
			Vitest.assert.deepStrictEqual(
				Arr.map(tokens, (event) =>
					event.type === "TokenAppended" ? event.payload.token : ""
				),
				["Hello", " from", " Acepe."]
			)
		})
	)
})

Vitest.it.live("recovers one assistant message after a mid-stream restart", () =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectory()
		const filename = path.join(dir, "acepe.db")
		const assistantMessageId = tracerAssistantMessageId(userMessageId)
		yield* Effect.scoped(
			Effect.gen(function*() {
				const engine = yield* OrchestrationEngine
				yield* engine.dispatch(createProject)
				yield* engine.dispatch(createSession)
				yield* engine.dispatch(sendMessage)
				yield* engine.dispatch(
					TokenAppendCommand.make({
						type: "token.append",
						commandId: tracerTokenCommandId(sessionId, assistantMessageId, 0),
						sessionId,
						messageId: assistantMessageId,
						token: TRACER_REPLY_TOKENS[0]
					})
				)
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(acepeEngineLive(filename).pipe(Layer.fresh))
			)
		)
		yield* Effect.scoped(
			Effect.gen(function*() {
				const provider = yield* HardcodedProvider
				const snapshots = yield* ProjectionSnapshotQuery
				yield* provider.waitForReply(userMessageId)
				let snapshot = yield* snapshots.snapshot(sessionId)
				for (const _step of Arr.range(0, 199)) {
					const assistant = Arr.findFirst(
						snapshot.messages,
						(row) => row.rowType === "assistant"
					)
					if (
						Option.isSome(assistant) &&
						assistant.value.rowType === "assistant" &&
						assistant.value.content.text === TRACER_REPLY_TEXT
					) {
						break
					}
					yield* Effect.sleep(Duration.millis(10))
					snapshot = yield* snapshots.snapshot(sessionId)
				}
				const messageIds = Arr.map(snapshot.messages, (row) => row.messageId)
				Vitest.assert.strictEqual(snapshot.messages.length, 2)
				Vitest.assert.strictEqual(messageIds.length, 2)
				Vitest.assert.strictEqual(new Set(messageIds).size, 2)
				const assistant = snapshot.messages[1]
				Vitest.assert.strictEqual(assistant?.rowType, "assistant")
				if (assistant?.rowType === "assistant") {
					Vitest.assert.strictEqual(assistant.content.text, TRACER_REPLY_TEXT)
				}
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(
					makeAcepeLive({
						filename,
						tokenDelay: Duration.zero
					}).pipe(Layer.fresh)
				)
			)
		)
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(Platform)
	),
	20_000
)
