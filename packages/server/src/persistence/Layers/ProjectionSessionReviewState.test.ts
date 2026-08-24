import {
	CommandId,
	EventId,
	type OrchestrationEvent,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import { ProjectionSessionReviewState } from "../Services/ProjectionSessionReviewState.ts"
import { ProjectionSessionReviewStateLive } from "./ProjectionSessionReviewState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")

const markedEvent = (
	session: SessionId,
	sequence: number,
	revisionKey: string,
	filePath: string,
	reviewed: boolean
): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: session,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SessionReviewFileMarked",
	payload: {
		sessionId: session,
		revisionKey,
		filePath,
		reviewed
	}
})

const clearedEvent = (session: SessionId, sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: session,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SessionReviewStateCleared",
	payload: { sessionId: session }
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

const ReviewStateLive = ProjectionSessionReviewStateLive.pipe(Layer.provideMerge(MigratedSqlite))

// One shared DB layer instance backs every it.effect below (per the
// Vitest.layer contract Effect uses elsewhere in this suite, e.g.
// ProjectionTerminal.test.ts), so each test uses its own sessionId to stay
// independent of what earlier tests in this block already wrote.

Vitest.layer(Layer.fresh(ReviewStateLive))("ProjectionSessionReviewStateLive", (it) => {
	it.effect("upserts a file's reviewed state from SessionReviewFileMarked", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-upsert")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			yield* sql.withTransaction(
				projection.apply(
					markedEvent(sessionId, 1, "src/index.ts:abc123", "src/index.ts", true),
					sql
				)
			)
			const files = yield* projection.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(files, [
				{ revisionKey: "src/index.ts:abc123", filePath: "src/index.ts", reviewed: true }
			])
		})
	)

	it.effect("re-marking the same revisionKey replaces the row instead of duplicating it", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-remark")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			yield* sql.withTransaction(
				projection.apply(
					markedEvent(sessionId, 1, "src/index.ts:abc123", "src/index.ts", true),
					sql
				)
			)
			yield* sql.withTransaction(
				projection.apply(
					markedEvent(sessionId, 2, "src/index.ts:abc123", "src/index.ts", false),
					sql
				)
			)
			const files = yield* projection.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(files, [
				{ revisionKey: "src/index.ts:abc123", filePath: "src/index.ts", reviewed: false }
			])
		})
	)

	it.effect("tracks multiple files for the same session independently", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-multi")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			yield* sql.withTransaction(
				projection.apply(markedEvent(sessionId, 1, "src/a.ts:hash1", "src/a.ts", true), sql)
			)
			yield* sql.withTransaction(
				projection.apply(markedEvent(sessionId, 2, "src/b.ts:hash2", "src/b.ts", false), sql)
			)
			const files = yield* projection.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(files, [
				{ revisionKey: "src/a.ts:hash1", filePath: "src/a.ts", reviewed: true },
				{ revisionKey: "src/b.ts:hash2", filePath: "src/b.ts", reviewed: false }
			])
		})
	)

	it.effect("clears every tracked file for a session on SessionReviewStateCleared", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-clear")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			yield* sql.withTransaction(
				projection.apply(markedEvent(sessionId, 1, "src/a.ts:hash1", "src/a.ts", true), sql)
			)
			yield* sql.withTransaction(
				projection.apply(markedEvent(sessionId, 2, "src/b.ts:hash2", "src/b.ts", true), sql)
			)
			yield* sql.withTransaction(projection.apply(clearedEvent(sessionId, 3), sql))
			const files = yield* projection.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(files, [])
		})
	)

	it.effect("clearing one session leaves other sessions untouched", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-clear-a")
			const otherSessionId = SessionId.make("session-clear-b")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			yield* sql.withTransaction(
				projection.apply(markedEvent(sessionId, 1, "src/a.ts:hash1", "src/a.ts", true), sql)
			)
			yield* sql.withTransaction(
				projection.apply(
					markedEvent(otherSessionId, 2, "src/c.ts:hash3", "src/c.ts", true),
					sql
				)
			)
			yield* sql.withTransaction(projection.apply(clearedEvent(sessionId, 3), sql))
			const cleared = yield* projection.listBySession(sessionId)
			const untouched = yield* projection.listBySession(otherSessionId)
			Vitest.assert.deepStrictEqual(cleared, [])
			Vitest.assert.deepStrictEqual(untouched, [
				{ revisionKey: "src/c.ts:hash3", filePath: "src/c.ts", reviewed: true }
			])
		})
	)

	it.effect("ignores unrelated event types", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-ignore")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			const unrelated: OrchestrationEvent = {
				sequence: 1,
				eventId: EventId.make("event-1"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt: NOW,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "SessionArchived",
				payload: { sessionId }
			}
			yield* sql.withTransaction(projection.apply(unrelated, sql))
			const files = yield* projection.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(files, [])
		})
	)

	it.effect("truncate removes every row", () =>
		Effect.gen(function*() {
			const sessionId = SessionId.make("session-truncate")
			const sql = yield* SqlClient.SqlClient
			const projection = yield* ProjectionSessionReviewState
			yield* sql.withTransaction(
				projection.apply(markedEvent(sessionId, 1, "src/a.ts:hash1", "src/a.ts", true), sql)
			)
			yield* sql.withTransaction(projection.truncate(sql))
			const files = yield* projection.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(files, [])
		})
	)
})

Vitest.describe("ProjectionSessionReviewStateLive name", () => {
	Vitest.it.effect("decodes the projector name", () =>
		Effect.gen(function*() {
			const name = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)(
				"projection.session-review-state"
			)
			Vitest.assert.strictEqual(name, "projection.session-review-state")
		})
	)
})
