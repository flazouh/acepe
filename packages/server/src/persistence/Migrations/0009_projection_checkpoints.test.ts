import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionCheckpoints from "./0009_projection_checkpoints.ts"

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

const CHECKPOINT_COLUMNS = [
	"checkpoint_id",
	"session_id",
	"sequence",
	"checkpoint_number",
	"name",
	"is_auto",
	"tool_call_id",
	"file_count",
	"status",
	"created_at",
	"last_reverted_at"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0009_projection_checkpoints table", (it) => {
	it.effect("creates projection_checkpoints keyed by checkpoint_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionCheckpoints
			const columns = yield* sql<{
				name: string
				pk: number
				notnull: number
			}>`
				PRAGMA table_info(projection_checkpoints)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...CHECKPOINT_COLUMNS]
			)
			const checkpointIdColumn = columns.find((column) => column.name === "checkpoint_id")
			Vitest.assert.isDefined(checkpointIdColumn)
			Vitest.assert.strictEqual(Number(checkpointIdColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0009_projection_checkpoints nullable columns", (it) => {
	it.effect("allows name, tool_call_id, and last_reverted_at to be null", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionCheckpoints
			const columns = yield* sql<{
				name: string
				notnull: number
			}>`
				PRAGMA table_info(projection_checkpoints)
			`.withoutTransform
			const name = columns.find((column) => column.name === "name")
			const toolCallId = columns.find((column) => column.name === "tool_call_id")
			const lastRevertedAt = columns.find((column) => column.name === "last_reverted_at")
			Vitest.assert.isDefined(name)
			Vitest.assert.isDefined(toolCallId)
			Vitest.assert.isDefined(lastRevertedAt)
			Vitest.assert.strictEqual(Number(name.notnull), 0)
			Vitest.assert.strictEqual(Number(toolCallId.notnull), 0)
			Vitest.assert.strictEqual(Number(lastRevertedAt.notnull), 0)
		})
	)
})

Vitest.layer(isolatedSqlite())("0009_projection_checkpoints one row per checkpoint", (it) => {
	it.effect("rejects a second row with the same checkpoint_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionCheckpoints
			yield* sql`
				INSERT INTO projection_checkpoints (
					checkpoint_id,
					session_id,
					sequence,
					checkpoint_number,
					name,
					is_auto,
					tool_call_id,
					file_count,
					status,
					created_at,
					last_reverted_at
				) VALUES (
					'checkpoint-1',
					'session-1',
					1,
					1,
					NULL,
					1,
					NULL,
					0,
					'missing',
					'2026-08-20T12:00:00.000Z',
					NULL
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_checkpoints (
					checkpoint_id,
					session_id,
					sequence,
					checkpoint_number,
					name,
					is_auto,
					tool_call_id,
					file_count,
					status,
					created_at,
					last_reverted_at
				) VALUES (
					'checkpoint-1',
					'session-1',
					2,
					2,
					NULL,
					0,
					NULL,
					0,
					'ready',
					'2026-08-20T12:00:00.000Z',
					NULL
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0009_projection_checkpoints status check", (it) => {
	it.effect("rejects a status outside ready, missing, or error", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionCheckpoints
			const error = yield* sql`
				INSERT INTO projection_checkpoints (
					checkpoint_id,
					session_id,
					sequence,
					checkpoint_number,
					name,
					is_auto,
					tool_call_id,
					file_count,
					status,
					created_at,
					last_reverted_at
				) VALUES (
					'checkpoint-1',
					'session-1',
					1,
					1,
					NULL,
					1,
					NULL,
					0,
					'pending',
					'2026-08-20T12:00:00.000Z',
					NULL
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
