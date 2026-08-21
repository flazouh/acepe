import {
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	TurnId
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import {
	assistantMessageRow,
	compactionSeamRow,
	ProjectionSessionMessages
} from "../Services/ProjectionSessionMessages.ts"
import { ProjectionSessionMessagesLive } from "./ProjectionSessionMessages.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const turnId = TurnId.make("turn-1")

const messageSent = (
	sequence: number,
	text: string,
	occurredAt: string,
	id: SessionId = sessionId
): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: id,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "MessageSent",
	payload: {
		sessionId: id,
		messageId: MessageId.make(`message-${sequence}`),
		text
	}
})

const projectCreated = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: "2026-08-20T12:00:00.000Z",
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
})

const compaction = compactionSeamRow({
	sessionId,
	sequence: 4,
	messageId: "seam-4",
	turnId: null,
	content: {
		status: "completed",
		trigger: "auto",
		preCompactionTokens: 180000,
		postCompactionTokens: 42000,
		contextWindowSize: 200000,
		droppedTokens: 138000,
		summary: "Compacted history"
	}
})

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

const TestProjectionSessionMessages = ProjectionSessionMessagesLive.pipe(
	Layer.provideMerge(MigratedSqlite)
)

const isolatedMessages = () => Layer.fresh(TestProjectionSessionMessages)

Vitest.layer(isolatedMessages())("apply MessageSent", (it) => {
	it.effect("stores decoded user content at the event sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.apply(
				messageSent(3, "Ship the transcript", "2026-08-20T18:00:00.000Z"),
				sql
			)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(listed, [
				{
					sessionId,
					sequence: 3,
					messageId: "message-3",
					turnId: null,
					rowType: "user",
					content: {
						text: "Ship the transcript"
					}
				}
			])
			const raw = yield* sql<{ content: string }>`
				SELECT content
				FROM projection_session_messages
				WHERE session_id = ${sessionId} AND sequence = 3
			`.withoutTransform
			Vitest.assert.strictEqual(raw[0]?.content, '{"text":"Ship the transcript"}')
		})
	)
})

Vitest.layer(isolatedMessages())("apply ignores non-transcript events", (it) => {
	it.effect("does not insert a ProjectCreated event", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.apply(projectCreated(1), sql)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(listed, [])
		})
	)
})

Vitest.layer(isolatedMessages())("shuffled arrival", (it) => {
	it.effect("lists rows in sequence order after a shuffled apply batch", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			const laterClock = messageSent(3, "first", "2026-08-20T18:00:00.000Z")
			const earlierClock = messageSent(5, "third", "2026-08-20T11:00:00.000Z")
			const last = messageSent(6, "fourth", "2026-08-20T12:00:00.000Z")
			yield* Effect.forEach(
				Arr.make(earlierClock, last, laterClock),
				(event) => messages.apply(event, sql),
				{ discard: true }
			)
			yield* messages.upsert(compaction, sql)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(
				listed.map((row) => row.sequence),
				[3, 4, 5, 6]
			)
			Vitest.assert.deepStrictEqual(
				listed.map((row) => row.rowType),
				["user", "compaction", "user", "user"]
			)
			Vitest.assert.deepStrictEqual(
				listed.map((row) => row.content),
				[
					{ text: "first" },
					{
						status: "completed",
						trigger: "auto",
						preCompactionTokens: 180000,
						postCompactionTokens: 42000,
						contextWindowSize: 200000,
						droppedTokens: 138000,
						summary: "Compacted history"
					},
					{ text: "third" },
					{ text: "fourth" }
				]
			)
		})
	)
})

Vitest.layer(isolatedMessages())("compaction seam rows", (it) => {
	it.effect("stores compaction as its own row type with decoded seam fields", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.upsert(compaction, sql)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.strictEqual(listed.length, 1)
			const row = listed[0]
			Vitest.assert.isDefined(row)
			Vitest.assert.strictEqual(row.rowType, "compaction")
			if (row.rowType !== "compaction") {
				return
			}
			Vitest.assert.strictEqual(row.content.status, "completed")
			Vitest.assert.strictEqual(row.content.trigger, "auto")
			Vitest.assert.strictEqual(row.content.preCompactionTokens, 180000)
			Vitest.assert.strictEqual(row.content.postCompactionTokens, 42000)
			Vitest.assert.strictEqual(row.content.contextWindowSize, 200000)
		})
	)
})

Vitest.layer(isolatedMessages())("assistant role and turn linkage", (it) => {
	it.effect("stores an assistant row with a turn id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.upsert(
				assistantMessageRow({
					sessionId,
					sequence: 8,
					messageId: "assistant-8",
					turnId,
					text: "Done"
				}),
				sql
			)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(listed, [
				{
					sessionId,
					sequence: 8,
					messageId: "assistant-8",
					turnId,
					rowType: "assistant",
					content: {
						text: "Done"
					}
				}
			])
		})
	)
})

Vitest.layer(isolatedMessages())("session isolation", (it) => {
	it.effect("lists only the requested session", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.apply(messageSent(1, "one", "2026-08-20T12:00:00.000Z"), sql)
			yield* messages.apply(
				messageSent(2, "two", "2026-08-20T12:00:00.000Z", otherSessionId),
				sql
			)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(
				listed.map((row) => row.messageId),
				["message-1"]
			)
		})
	)
})

Vitest.layer(isolatedMessages())("apply is idempotent", (it) => {
	it.effect("replaces the same sequence instead of duplicating it", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.apply(messageSent(1, "first", "2026-08-20T12:00:00.000Z"), sql)
			yield* messages.apply(messageSent(1, "first", "2026-08-20T12:00:00.000Z"), sql)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.strictEqual(listed.length, 1)
		})
	)
})

Vitest.layer(isolatedMessages())("truncate", (it) => {
	it.effect("removes every projected message row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const messages = yield* ProjectionSessionMessages
			yield* messages.apply(messageSent(1, "one", "2026-08-20T12:00:00.000Z"), sql)
			yield* messages.truncate(sql)
			const listed = yield* messages.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(listed, [])
		})
	)
})
