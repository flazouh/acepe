import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionMessages from "./0005_projection_messages.ts"

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

const MESSAGE_COLUMNS = [
	"session_id",
	"sequence",
	"message_id",
	"turn_id",
	"row_type",
	"content"
] as const

Vitest.layer(isolatedSqlite())("0005_projection_messages table", (it) => {
	it.effect("creates projection_session_messages keyed by session_id and sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionMessages
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_session_messages)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...MESSAGE_COLUMNS]
			)
			const sessionIdColumn = columns.find((column) => column.name === "session_id")
			const sequenceColumn = columns.find((column) => column.name === "sequence")
			Vitest.assert.isDefined(sessionIdColumn)
			Vitest.assert.isDefined(sequenceColumn)
			Vitest.assert.strictEqual(Number(sessionIdColumn.pk), 1)
			Vitest.assert.strictEqual(Number(sequenceColumn.pk), 2)
		})
	)
})

Vitest.layer(isolatedSqlite())("0005_projection_messages order", (it) => {
	it.effect("selects by sequence after shuffled inserts, not insertion order", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionMessages
			yield* sql`
				INSERT INTO projection_session_messages (
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				) VALUES (
					'session-1',
					5,
					'message-5',
					NULL,
					'user',
					'{"text":"late"}'
				)
			`.withoutTransform
			yield* sql`
				INSERT INTO projection_session_messages (
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				) VALUES (
					'session-1',
					3,
					'message-3',
					NULL,
					'user',
					'{"text":"early"}'
				)
			`.withoutTransform
			yield* sql`
				INSERT INTO projection_session_messages (
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				) VALUES (
					'session-1',
					4,
					'seam-4',
					NULL,
					'compaction',
					'{"status":"completed","trigger":"auto","preCompactionTokens":180000,"postCompactionTokens":42000,"contextWindowSize":200000,"droppedTokens":138000,"summary":null}'
				)
			`.withoutTransform
			const rows = yield* sql<{
				sequence: number
				row_type: string
			}>`
				SELECT sequence, row_type
				FROM projection_session_messages
				WHERE session_id = 'session-1'
				ORDER BY sequence ASC
			`.withoutTransform
			Vitest.assert.deepStrictEqual(rows, [
				{ sequence: 3, row_type: "user" },
				{ sequence: 4, row_type: "compaction" },
				{ sequence: 5, row_type: "user" }
			])
		})
	)
})

Vitest.layer(isolatedSqlite())("0005_projection_messages row_type", (it) => {
	it.effect("rejects a row_type that is not a transcript role or compaction seam", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionMessages
			const error = yield* sql`
				INSERT INTO projection_session_messages (
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				) VALUES (
					'session-1',
					1,
					'blob-1',
					NULL,
					'provider_blob',
					'{"raw":true}'
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
