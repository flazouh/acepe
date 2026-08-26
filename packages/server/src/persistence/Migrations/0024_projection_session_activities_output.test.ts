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
import projectionSessionActivitiesOutput from "./0024_projection_session_activities_output.ts"

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

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0024_projection_session_activities_output column", (it) => {
	it.effect("adds a nullable output column and leaves an existing row's output null", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionActivities
			yield* sql`
				INSERT INTO projection_session_activities (
					activity_id,
					session_id,
					sequence,
					status_sequence,
					kind,
					tool_call_id,
					operation_id,
					status,
					title,
					path
				) VALUES ('activity-1', 'session-1', 3, 3, 'tool', 'call-1', NULL, 'completed', 'Bash', NULL)
			`.withoutTransform
			yield* projectionSessionActivitiesOutput
			const columns = yield* sql<{
				name: string
				notnull: number
				dflt_value: string | null
			}>`
				PRAGMA table_info(projection_session_activities)
			`.withoutTransform
			const output = columns.find((column) => column.name === "output")
			Vitest.assert.isDefined(output)
			Vitest.assert.strictEqual(Number(output.notnull), 0)
			Vitest.assert.isNull(output.dflt_value)
			const rows = yield* sql<{ output: string | null }>`
				SELECT output
				FROM projection_session_activities
				WHERE activity_id = 'activity-1'
			`.withoutTransform
			Vitest.assert.strictEqual(rows.length, 1)
			Vitest.assert.isNull(rows[0]?.output ?? null)
		})
	)
})
