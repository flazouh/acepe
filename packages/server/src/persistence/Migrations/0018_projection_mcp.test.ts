import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionMcp from "./0018_projection_mcp.ts"

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

const MCP_COLUMNS = ["project_id", "catalog_json", "provider_id", "options_json", "sequence"] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0018_projection_mcp table", (it) => {
	it.effect("creates projection_mcp keyed by project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionMcp
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_mcp)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...MCP_COLUMNS]
			)
			const keyColumn = columns.find((column) => column.name === "project_id")
			Vitest.assert.isDefined(keyColumn)
			Vitest.assert.strictEqual(Number(keyColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0018_projection_mcp one row per project", (it) => {
	it.effect("rejects a second row with the same project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionMcp
			yield* sql`
				INSERT INTO projection_mcp (
					project_id,
					catalog_json,
					provider_id,
					options_json,
					sequence
				) VALUES (
					'project-1',
					'{"source":"preconnectionConfig","servers":[]}',
					'claude-code',
					'[]',
					1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_mcp (
					project_id,
					catalog_json,
					provider_id,
					options_json,
					sequence
				) VALUES (
					'project-1',
					'{"source":"preconnectionConfig","servers":[]}',
					'claude-code',
					'[]',
					2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
