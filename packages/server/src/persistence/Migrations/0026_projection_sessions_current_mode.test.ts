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
import projectionSessionsCurrentMode from "./0026_projection_sessions_current_mode.ts"

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

Vitest.layer(isolatedSqlite())("0026_projection_sessions_current_mode columns", (it) => {
	it.effect("adds a nullable current_mode_id column", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			yield* projectionSessionsCurrentMode
			const columns = yield* sql<{
				name: string
				notnull: number
				dflt_value: string | null
			}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform
			const currentModeId = columns.find((column) => column.name === "current_mode_id")
			Vitest.assert.isDefined(currentModeId)
			Vitest.assert.strictEqual(Number(currentModeId.notnull), 0)
			Vitest.assert.strictEqual(currentModeId.dflt_value, null)
		})
	)
})
