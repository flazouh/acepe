import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionSessionReviewState from "./0020_projection_session_review_state.ts"

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

const SESSION_REVIEW_STATE_COLUMNS = [
	"session_id",
	"revision_key",
	"file_path",
	"reviewed",
	"sequence"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0020_projection_session_review_state table", (it) => {
	it.effect("creates projection_session_review_state keyed by (session_id, revision_key)", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionReviewState
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_session_review_state)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...SESSION_REVIEW_STATE_COLUMNS]
			)
			const keyColumns = columns.filter((column) => column.pk > 0)
			Vitest.assert.deepStrictEqual(
				keyColumns.map((column) => column.name).sort(),
				["revision_key", "session_id"]
			)
		})
	)
})

Vitest.layer(isolatedSqlite())("0020_projection_session_review_state one row per file", (it) => {
	it.effect("rejects a second row with the same (session_id, revision_key)", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionReviewState
			yield* sql`
				INSERT INTO projection_session_review_state (
					session_id, revision_key, file_path, reviewed, sequence
				) VALUES (
					'session-1', 'src/index.ts:abc123', 'src/index.ts', 1, 1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_session_review_state (
					session_id, revision_key, file_path, reviewed, sequence
				) VALUES (
					'session-1', 'src/index.ts:abc123', 'src/index.ts', 0, 2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0020_projection_session_review_state index", (it) => {
	it.effect("allows multiple files for one session", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessionReviewState
			yield* sql`
				INSERT INTO projection_session_review_state (
					session_id, revision_key, file_path, reviewed, sequence
				) VALUES (
					'session-1', 'src/a.ts:hash1', 'src/a.ts', 1, 1
				)
			`.withoutTransform
			yield* sql`
				INSERT INTO projection_session_review_state (
					session_id, revision_key, file_path, reviewed, sequence
				) VALUES (
					'session-1', 'src/b.ts:hash2', 'src/b.ts', 0, 2
				)
			`.withoutTransform
			const rows = yield* sql`
				SELECT session_id FROM projection_session_review_state WHERE session_id = 'session-1'
			`.withoutTransform
			Vitest.assert.strictEqual(rows.length, 2)
		})
	)
})
