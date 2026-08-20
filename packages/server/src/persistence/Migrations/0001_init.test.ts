import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import init from "./0001_init.ts"

const SEA_ORM_TABLES = ["projects", "session_metadata", "acepe_session_state"] as const

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

Vitest.layer(TempSqlite)("0001_init", (it) => {
	it.effect("does not create or alter sea-orm tables", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* init
			const tables = yield* sql<{ name: string }>`
				SELECT name FROM sqlite_master WHERE type = 'table'
			`.withoutTransform
			const names = tables.map((table) => table.name)
			for (const table of SEA_ORM_TABLES) {
				Vitest.assert.isFalse(names.includes(table))
			}
		})
	)
})
