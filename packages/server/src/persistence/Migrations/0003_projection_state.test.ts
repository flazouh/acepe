import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionState from "./0003_projection_state.ts"

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

Vitest.layer(TempSqlite)("0003_projection_state", (it) => {
	it.effect("creates projection_state keyed by projector name", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionState
			const columns = yield* sql<{ name: string; pk: number }>`
				PRAGMA table_info(projection_state)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				["name", "last_applied_sequence"]
			)
			const nameColumn = columns.find((column) => column.name === "name")
			Vitest.assert.isDefined(nameColumn)
			Vitest.assert.strictEqual(Number(nameColumn.pk), 1)
		})
	)
})
