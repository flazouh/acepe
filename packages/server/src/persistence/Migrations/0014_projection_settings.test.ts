import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionSettings from "./0014_projection_settings.ts"

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

const SETTING_COLUMNS = ["setting_key", "setting_value", "sequence"] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0014_projection_settings table", (it) => {
	it.effect("creates projection_settings keyed by setting_key", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSettings
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_settings)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...SETTING_COLUMNS]
			)
			const keyColumn = columns.find((column) => column.name === "setting_key")
			Vitest.assert.isDefined(keyColumn)
			Vitest.assert.strictEqual(Number(keyColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0014_projection_settings one row per key", (it) => {
	it.effect("rejects a second row with the same setting_key", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSettings
			yield* sql`
				INSERT INTO projection_settings (
					setting_key,
					setting_value,
					sequence
				) VALUES (
					'ui_font_size',
					'14',
					1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_settings (
					setting_key,
					setting_value,
					sequence
				) VALUES (
					'ui_font_size',
					'16',
					2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0014_projection_settings sequence check", (it) => {
	it.effect("rejects a negative sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSettings
			const error = yield* sql`
				INSERT INTO projection_settings (
					setting_key,
					setting_value,
					sequence
				) VALUES (
					'ui_font_size',
					'14',
					-1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0014_projection_settings empty key", (it) => {
	it.effect("rejects an empty setting_key", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSettings
			const error = yield* sql`
				INSERT INTO projection_settings (
					setting_key,
					setting_value,
					sequence
				) VALUES (
					'',
					'14',
					1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
