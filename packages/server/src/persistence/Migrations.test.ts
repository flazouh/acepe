import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "./Layers/Sqlite.ts"
import { runMigrations } from "./Migrations.ts"

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

Vitest.layer(TempSqlite)("runMigrations", (it) => {
	it.effect("records 0001_init in _migrations and applies nothing on the second run", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const first = yield* runMigrations
			const second = yield* runMigrations
			const rows = yield* sql<{
				migration_id: number
				name: string
			}>`SELECT migration_id, name FROM _migrations ORDER BY migration_id`.withoutTransform
			Vitest.assert.deepStrictEqual(first, [
				[1, "init"],
				[2, "event_store"],
				[3, "projection_state"],
				[4, "command_receipts"],
				[5, "projection_messages"],
				[6, "projection_sessions"],
				[7, "projection_turns"],
				[11, "projection_projects"]
			])
			Vitest.assert.deepStrictEqual(second, [])
			Vitest.assert.deepStrictEqual(rows, [
				{ migration_id: 1, name: "init" },
				{ migration_id: 2, name: "event_store" },
				{ migration_id: 3, name: "projection_state" },
				{ migration_id: 4, name: "command_receipts" },
				{ migration_id: 5, name: "projection_messages" },
				{ migration_id: 6, name: "projection_sessions" },
				{ migration_id: 7, name: "projection_turns" },
				{ migration_id: 11, name: "projection_projects" }
			])
		})
	)
})
