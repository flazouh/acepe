import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionTerminal from "./0019_projection_terminal.ts"

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

const TERMINAL_COLUMNS = [
	"terminal_id",
	"session_id",
	"cwd",
	"cols",
	"rows",
	"output",
	"closed",
	"sequence"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0019_projection_terminal table", (it) => {
	it.effect("creates projection_terminal keyed by terminal_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTerminal
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_terminal)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...TERMINAL_COLUMNS]
			)
			const keyColumn = columns.find((column) => column.name === "terminal_id")
			Vitest.assert.isDefined(keyColumn)
			Vitest.assert.strictEqual(Number(keyColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0019_projection_terminal one row per terminal", (it) => {
	it.effect("rejects a second row with the same terminal_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTerminal
			yield* sql`
				INSERT INTO projection_terminal (
					terminal_id, session_id, cwd, cols, rows, output, closed, sequence
				) VALUES (
					'term-1', 'session-1', '/tmp', 80, 24, '', 0, 1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_terminal (
					terminal_id, session_id, cwd, cols, rows, output, closed, sequence
				) VALUES (
					'term-1', 'session-1', '/tmp', 80, 24, 'hi', 0, 2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
