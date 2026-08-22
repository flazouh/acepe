import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionSkills from "./0015_projection_skills.ts"

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

const CATALOG_COLUMNS = [
	"catalog_id",
	"agents_json",
	"agent_skills_json",
	"plugins_json",
	"plugin_skills_json",
	"tree_json",
	"sequence"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0015_projection_skills table", (it) => {
	it.effect("creates projection_skills_catalog keyed by catalog_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSkills
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_skills_catalog)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...CATALOG_COLUMNS]
			)
			const keyColumn = columns.find((column) => column.name === "catalog_id")
			Vitest.assert.isDefined(keyColumn)
			Vitest.assert.strictEqual(Number(keyColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0015_projection_skills one row per catalog", (it) => {
	it.effect("rejects a second row with the same catalog_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSkills
			yield* sql`
				INSERT INTO projection_skills_catalog (
					catalog_id,
					agents_json,
					agent_skills_json,
					plugins_json,
					plugin_skills_json,
					tree_json,
					sequence
				) VALUES (
					'app',
					'[]',
					'[]',
					'[]',
					'[]',
					'[]',
					1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_skills_catalog (
					catalog_id,
					agents_json,
					agent_skills_json,
					plugins_json,
					plugin_skills_json,
					tree_json,
					sequence
				) VALUES (
					'app',
					'[]',
					'[]',
					'[]',
					'[]',
					'[]',
					2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0015_projection_skills sequence check", (it) => {
	it.effect("rejects a negative sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSkills
			const error = yield* sql`
				INSERT INTO projection_skills_catalog (
					catalog_id,
					agents_json,
					agent_skills_json,
					plugins_json,
					plugin_skills_json,
					tree_json,
					sequence
				) VALUES (
					'app',
					'[]',
					'[]',
					'[]',
					'[]',
					'[]',
					-1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0015_projection_skills empty catalog_id", (it) => {
	it.effect("rejects an empty catalog_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSkills
			const error = yield* sql`
				INSERT INTO projection_skills_catalog (
					catalog_id,
					agents_json,
					agent_skills_json,
					plugins_json,
					plugin_skills_json,
					tree_json,
					sequence
				) VALUES (
					'',
					'[]',
					'[]',
					'[]',
					'[]',
					'[]',
					1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
