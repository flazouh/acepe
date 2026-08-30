import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionProjects from "./0011_projection_projects.ts"
import projectionProjectsSortOrder from "./0033_projection_projects_sort_order.ts"

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

Vitest.layer(isolatedSqlite())("0033_projection_projects_sort_order columns", (it) => {
	it.effect("adds a nullable sort_order column", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			yield* projectionProjectsSortOrder
			const columns = yield* sql<{
				name: string
				notnull: number
				dflt_value: string | null
			}>`
				PRAGMA table_info(projection_projects)
			`.withoutTransform
			const column = columns.find((candidate) => candidate.name === "sort_order")
			Vitest.assert.isDefined(column, "sort_order must exist")
			Vitest.assert.strictEqual(Number(column.notnull), 0)
			Vitest.assert.strictEqual(column.dflt_value, null)
		})
	)
})
