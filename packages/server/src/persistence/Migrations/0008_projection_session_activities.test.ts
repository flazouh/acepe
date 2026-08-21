import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionSessionActivities from "./0008_projection_session_activities.ts"

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

const ACTIVITY_COLUMNS = [
	"activity_id",
	"session_id",
	"sequence",
	"status_sequence",
	"kind",
	"tool_call_id",
	"operation_id",
	"status",
	"title",
	"path"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0008_projection_session_activities table", (it) => {
	it.effect("creates projection_session_activities keyed by activity_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionActivities
			const columns = yield* sql<{
				name: string
				pk: number
				notnull: number
			}>`
				PRAGMA table_info(projection_session_activities)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...ACTIVITY_COLUMNS]
			)
			const activityIdColumn = columns.find((column) => column.name === "activity_id")
			Vitest.assert.isDefined(activityIdColumn)
			Vitest.assert.strictEqual(Number(activityIdColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0008 snapshot stub insert", (it) => {
	it.effect("accepts activity_id, session_id, sequence and fills defaults", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionActivities
			yield* sql`
				INSERT INTO projection_session_activities (activity_id, session_id, sequence)
				VALUES ('activity-1', 'session-1', 4)
			`.withoutTransform
			const rows = yield* sql<{
				status: string
				kind: string
				operation_id: string | null
				title: string
			}>`
				SELECT status, kind, operation_id, title
				FROM projection_session_activities
				WHERE activity_id = 'activity-1'
			`.withoutTransform
			Vitest.assert.strictEqual(rows[0]?.status, "pending")
			Vitest.assert.strictEqual(rows[0]?.kind, "tool")
			Vitest.assert.strictEqual(rows[0]?.operation_id, null)
			Vitest.assert.strictEqual(rows[0]?.title, "activity")
		})
	)
})

Vitest.layer(isolatedSqlite())("0008_projection_session_activities checks", (it) => {
	it.effect("rejects a status that is not a known activity status", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionActivities
			const error = yield* sql`
				INSERT INTO projection_session_activities (
					activity_id,
					session_id,
					sequence,
					status
				) VALUES (
					'activity-1',
					'session-1',
					1,
					'running'
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0008 one row per activity", (it) => {
	it.effect("rejects a second row with the same activity_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionActivities
			yield* sql`
				INSERT INTO projection_session_activities (activity_id, session_id, sequence)
				VALUES ('activity-1', 'session-1', 1)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_session_activities (activity_id, session_id, sequence)
				VALUES ('activity-1', 'session-1', 2)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
