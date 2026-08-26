import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionTurns from "./0007_projection_turns.ts"
import projectionTurnsContextWindow from "./0023_projection_turns_context_window.ts"

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

Vitest.layer(isolatedSqlite())("0023_projection_turns_context_window column", (it) => {
	it.effect("adds a nullable context_window_size column to projection_turns", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTurns
			yield* projectionTurnsContextWindow
			const columns = yield* sql<{
				name: string
				notnull: number
				dflt_value: string | null
			}>`
				PRAGMA table_info(projection_turns)
			`.withoutTransform
			const contextWindowSize = columns.find((column) => column.name === "context_window_size")
			Vitest.assert.isDefined(contextWindowSize)
			Vitest.assert.strictEqual(Number(contextWindowSize.notnull), 0)
			Vitest.assert.isNull(contextWindowSize.dflt_value)
		})
	)
})
