import { SessionId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer, resolveAcepeSqliteFilename } from "../persistence/Layers/Sqlite.ts"
import { RUST_CHECKPOINT_COLUMNS, RUST_FILE_SNAPSHOT_COLUMNS, applyLiveRustCheckpointSchema } from "./rustSchema.ts"
import { listStoredCheckpoints } from "./snapshotStore.ts"

/** Real session id from ~/Library/Application Support/Acepe/acepe.db on 2026-08-21. */
const LIVE_SESSION_ID = SessionId.make("79dcd983-8039-41c7-9b88-2f2f1fbfe642")

const TestPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

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
).pipe(Layer.provide(TestPlatform))

const isolatedSqlite = () => Layer.fresh(TempSqlite)

const LiveReadonlySqlite = Layer.unwrap(
	Effect.gen(function*() {
		const filename = yield* resolveAcepeSqliteFilename
		return makeSqliteLayer({ filename, readonly: true })
	})
).pipe(Layer.provideMerge(TestPlatform))

Vitest.layer(isolatedSqlite())("applyLiveRustCheckpointSchema", (it) => {
	it.effect("creates the live Acepe checkpoint columns", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* applyLiveRustCheckpointSchema()
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

const liveDatabaseExists = await Effect.runPromise(
	Effect.gen(function*() {
		const filename = yield* resolveAcepeSqliteFilename
		const fs = yield* FileSystem.FileSystem
		return yield* fs.exists(filename)
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		// Module scope in a test file is an entry point: this runs once, before any suite.
		Effect.provide(TestPlatform),
		Effect.catch(() => Effect.succeed(false))
	)
)

if (liveDatabaseExists === false) {
	Vitest.describe.skip("live Acepe checkpoint schema", () => {
		Vitest.it("skipped: no Acepe database on this machine", () => {})
	})
}

const describeLive = liveDatabaseExists
	? Vitest.layer(LiveReadonlySqlite)
	: (_name: string, _suite: unknown) => {}

describeLive("live Acepe checkpoint schema", (it) => {
	it.effect("matches the rust checkpoint columns in the live database", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
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
			const listed = yield* listStoredCheckpoints(sql, LIVE_SESSION_ID)
			Vitest.assert.isArray(listed)
		})
	)
})
