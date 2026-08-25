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
import projectionProjectsColor from "./0021_projection_projects_color.ts"

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

Vitest.layer(isolatedSqlite())("0021_projection_projects_color columns", (it) => {
	it.effect("adds a nullable color column to projection_projects", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			yield* projectionProjectsColor
			const columns = yield* sql<{
				name: string
				notnull: number
			}>`
				PRAGMA table_info(projection_projects)
			`.withoutTransform
			const color = columns.find((column) => column.name === "color")
			Vitest.assert.isDefined(color)
			Vitest.assert.strictEqual(Number(color.notnull), 0)
		})
	)
})
