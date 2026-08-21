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

const TURN_COLUMNS = [
	"turn_id",
	"session_id",
	"sequence",
	"status",
	"started_at",
	"ended_at",
	"cancelled_at",
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
	"cache_write_tokens",
	"cost_usd"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0007_projection_turns table", (it) => {
	it.effect("creates projection_turns keyed by turn_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTurns
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_turns)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...TURN_COLUMNS]
			)
			const turnIdColumn = columns.find((column) => column.name === "turn_id")
			Vitest.assert.isDefined(turnIdColumn)
			Vitest.assert.strictEqual(Number(turnIdColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0007_projection_turns snapshot columns", (it) => {
	it.effect("accepts an insert of only turn_id, session_id, and sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTurns
			yield* sql`
				INSERT INTO projection_turns (turn_id, session_id, sequence)
				VALUES ('turn-1', 'session-1', 3)
			`.withoutTransform
			const rows = yield* sql<{
				turn_id: string
				status: string
				output_tokens: number
				cost_usd: number
			}>`
				SELECT turn_id, status, output_tokens, cost_usd
				FROM projection_turns
			`.withoutTransform
			Vitest.assert.strictEqual(rows[0]?.turn_id, "turn-1")
			Vitest.assert.strictEqual(rows[0]?.status, "running")
			Vitest.assert.strictEqual(Number(rows[0]?.output_tokens), 0)
			Vitest.assert.strictEqual(Number(rows[0]?.cost_usd), 0)
		})
	)
})

Vitest.layer(isolatedSqlite())("0007_projection_turns one row per turn", (it) => {
	it.effect("rejects a second row with the same turn_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTurns
			yield* sql`
				INSERT INTO projection_turns (turn_id, session_id, sequence)
				VALUES ('turn-1', 'session-1', 3)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_turns (turn_id, session_id, sequence)
				VALUES ('turn-1', 'session-1', 4)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0007_projection_turns status check", (it) => {
	it.effect("rejects a status that is not running, completed, or cancelled", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionTurns
			const error = yield* sql`
				INSERT INTO projection_turns (
					turn_id,
					session_id,
					sequence,
					status
				) VALUES (
					'turn-1',
					'session-1',
					3,
					'interrupted'
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
