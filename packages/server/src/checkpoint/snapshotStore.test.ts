import { CheckpointId, SessionId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { applyLiveRustCheckpointSchema } from "./rustSchema.ts"
import { getStoredFileContent, listStoredCheckpoints } from "./snapshotStore.ts"

/** Real session id from ~/Library/Application Support/Acepe/acepe.db on 2026-08-21. */
const LIVE_SESSION_ID = SessionId.make("79dcd983-8039-41c7-9b88-2f2f1fbfe642")
const RUST_CHECKPOINT_ID = CheckpointId.make("c0ffeeee-1111-4222-8333-444444444444")
const RUST_SNAPSHOT_ID = "s0ffeeee-1111-4222-8333-444444444444"
const HELLO_WORLD = "hello world"
const HELLO_WORLD_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
const CREATED_AT = 1_710_000_000_000

const TempSqlite = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return makeSqliteLayer({
			filename: path.join(dir, "rust-checkpoints.db"),
			readonly: false
		})
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const isolatedSqlite = () => Layer.fresh(TempSqlite)

const insertRustCheckpoint = Effect.fn("insertRustCheckpoint")(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* applyLiveRustCheckpointSchema()
	yield* sql`
		INSERT INTO session_metadata (id) VALUES (${LIVE_SESSION_ID})
	`.withoutTransform
	yield* sql`
		INSERT INTO checkpoints (
			id, session_id, checkpoint_number, name, created_at, tool_call_id, is_auto
		) VALUES (
			${RUST_CHECKPOINT_ID},
			${LIVE_SESSION_ID},
			1,
			'After edit',
			${CREATED_AT},
			'toolu_live_1',
			1
		)
	`.withoutTransform
	yield* sql`
		INSERT INTO file_snapshots (
			id, checkpoint_id, file_path, content_hash, content, file_size, lines_added, lines_removed
		) VALUES (
			${RUST_SNAPSHOT_ID},
			${RUST_CHECKPOINT_ID},
			'src/hello.ts',
			${HELLO_WORLD_SHA256},
			${HELLO_WORLD},
			11,
			1,
			0
		)
	`.withoutTransform
})

Vitest.layer(isolatedSqlite())("listStoredCheckpoints rust schema", (it) => {
	it.effect("reads a rust-format checkpoint keyed by a live Acepe session id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* insertRustCheckpoint()
			const listed = yield* listStoredCheckpoints(sql, LIVE_SESSION_ID)
			Vitest.assert.strictEqual(listed.length, 1)
			const checkpoint = listed[0]
			Vitest.assert.isDefined(checkpoint)
			Vitest.assert.strictEqual(checkpoint.id, RUST_CHECKPOINT_ID)
			Vitest.assert.strictEqual(checkpoint.sessionId, LIVE_SESSION_ID)
			Vitest.assert.strictEqual(checkpoint.checkpointNumber, 1)
			Vitest.assert.strictEqual(checkpoint.name, "After edit")
			Vitest.assert.strictEqual(checkpoint.createdAt, CREATED_AT)
			Vitest.assert.strictEqual(checkpoint.toolCallId, "toolu_live_1")
			Vitest.assert.strictEqual(checkpoint.isAuto, true)
			Vitest.assert.strictEqual(checkpoint.fileCount, 1)
			Vitest.assert.strictEqual(checkpoint.totalLinesAdded, 1)
			Vitest.assert.strictEqual(checkpoint.totalLinesRemoved, 0)
			const content = yield* getStoredFileContent(sql, RUST_CHECKPOINT_ID, "src/hello.ts")
			Vitest.assert.deepStrictEqual(content, Option.some(HELLO_WORLD))
		})
	)
})
