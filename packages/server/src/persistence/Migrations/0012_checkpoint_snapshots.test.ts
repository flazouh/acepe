import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import checkpointSnapshots from "./0012_checkpoint_snapshots.ts"
import { RUST_CHECKPOINT_COLUMNS, RUST_FILE_SNAPSHOT_COLUMNS } from "../../checkpoint/rustSchema.ts"

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

Vitest.layer(isolatedSqlite())("0012_checkpoint_snapshots table", (it) => {
	it.effect("creates rust-compatible checkpoints and file_snapshots tables", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* checkpointSnapshots
			const checkpointColumns = yield* sql<{ name: string }>`
				PRAGMA table_info(checkpoints)
			`.withoutTransform
			const snapshotColumns = yield* sql<{ name: string }>`
				PRAGMA table_info(file_snapshots)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				checkpointColumns.map((column) => column.name),
				Array.from(RUST_CHECKPOINT_COLUMNS)
			)
			Vitest.assert.deepStrictEqual(
				snapshotColumns.map((column) => column.name),
				Array.from(RUST_FILE_SNAPSHOT_COLUMNS)
			)
		})
	)
})

Vitest.layer(isolatedSqlite())("0012_checkpoint_snapshots uniqueness", (it) => {
	it.effect("rejects a second checkpoint with the same session number", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* checkpointSnapshots
			yield* sql`
				INSERT INTO checkpoints (
					id, session_id, checkpoint_number, name, created_at, tool_call_id, is_auto
				) VALUES (
					'checkpoint-1', 'session-1', 1, NULL, 1710000000000, NULL, 1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO checkpoints (
					id, session_id, checkpoint_number, name, created_at, tool_call_id, is_auto
				) VALUES (
					'checkpoint-2', 'session-1', 1, NULL, 1710000000001, NULL, 0
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
