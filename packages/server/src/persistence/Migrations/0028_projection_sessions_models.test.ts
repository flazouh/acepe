import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionSessions from "./0006_projection_sessions.ts"
import projectionSessionsModels from "./0028_projection_sessions_models.ts"

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

Vitest.layer(isolatedSqlite())("0028_projection_sessions_models columns", (it) => {
	it.effect("adds nullable current_model_id and available_models columns", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			yield* projectionSessionsModels
			const columns = yield* sql<{
				name: string
				notnull: number
				dflt_value: string | null
			}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform
			for (const name of ["current_model_id", "available_models"]) {
				const column = columns.find((candidate) => candidate.name === name)
				Vitest.assert.isDefined(column, `${name} must exist`)
				Vitest.assert.strictEqual(Number(column.notnull), 0)
				Vitest.assert.strictEqual(column.dflt_value, null)
			}
		})
	)
})
