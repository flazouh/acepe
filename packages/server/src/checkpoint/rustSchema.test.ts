import { SessionId } from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer, resolveAcepeSqliteFilename } from "../persistence/Layers/Sqlite.ts"
import { RUST_CHECKPOINT_COLUMNS, RUST_FILE_SNAPSHOT_COLUMNS, applyLiveRustCheckpointSchema } from "./rustSchema.ts"
import { getStoredFileContent, listStoredCheckpoints } from "./snapshotStore.ts"

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

type LiveSqliteProbe = {
	readonly filename: string | null
	readonly checkpointCount: number
	readonly snapshotCount: number
}

const countFromRows = (rows: ReadonlyArray<{ readonly n: number | bigint }>): number => {
	const first = Arr.head(rows)
	if (Option.isNone(first)) {
		return 0
	}
	return Number(first.value.n)
}

const firstExistingFile = Effect.fn("firstExistingFile")(function*(
	candidates: ReadonlyArray<string>
) {
	const fs = yield* FileSystem.FileSystem
	for (const candidate of candidates) {
		if (yield* fs.exists(candidate)) {
			return Option.some(candidate)
		}
	}
	return Option.none<string>()
})

const countLiveCheckpointRows = Effect.fn("countLiveCheckpointRows")(function*(filename: string) {
	return yield* Effect.scoped(
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const checkpointRows = yield* sql<{ n: number | bigint }>`
				SELECT COUNT(*) AS n FROM checkpoints
			`.withoutTransform.pipe(Effect.catch(() => Effect.succeed(Arr.empty<{ n: number | bigint }>())))
			const snapshotRows = yield* sql<{ n: number | bigint }>`
				SELECT COUNT(*) AS n FROM file_snapshots
			`.withoutTransform.pipe(Effect.catch(() => Effect.succeed(Arr.empty<{ n: number | bigint }>())))
			return {
				checkpointCount: countFromRows(checkpointRows),
				snapshotCount: countFromRows(snapshotRows)
			}
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			// Module-scope live probe opens the Acepe sqlite file once, before suites.
			Effect.provide(makeSqliteLayer({ filename, readonly: true }))
		)
	)
})

const probeLiveSqlite = Effect.gen(function*() {
	const path = yield* Path.Path
	const home = yield* Config.string("HOME").pipe(Config.orElse(() => Config.string("USERPROFILE")))
	const productionDb = path.join(home, "Library", "Application Support", "Acepe", "acepe.db")
	const resolved = yield* resolveAcepeSqliteFilename
	const candidates = productionDb === resolved ? Arr.of(productionDb) : Arr.make(productionDb, resolved)
	const filename = yield* firstExistingFile(candidates)
	if (Option.isNone(filename)) {
		return {
			filename: null,
			checkpointCount: 0,
			snapshotCount: 0
		} satisfies LiveSqliteProbe
	}
	const counts = yield* countLiveCheckpointRows(filename.value)
	return {
		filename: filename.value,
		checkpointCount: counts.checkpointCount,
		snapshotCount: counts.snapshotCount
	} satisfies LiveSqliteProbe
})

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

const liveProbe = await Effect.runPromise(
	probeLiveSqlite.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		// Module scope in a test file is an entry point: this runs once, before any suite.
		Effect.provide(TestPlatform),
		Effect.catch(() =>
			Effect.succeed({
				filename: null,
				checkpointCount: 0,
				snapshotCount: 0
			} satisfies LiveSqliteProbe)
		)
	)
)

const liveFilename = liveProbe.filename
const liveDatabaseExists = liveFilename !== null
const liveHasFileContent = liveProbe.checkpointCount > 0 && liveProbe.snapshotCount > 0

if (liveDatabaseExists === true && liveHasFileContent === false) {
	Vitest.describe.skip("live Acepe checkpoint schema", () => {
		Vitest.it(
			"skipped: the live database has no checkpoint rows, so Rust compatibility is unproven",
			() => {}
		)
	})
}

if (liveDatabaseExists === false) {
	Vitest.describe.skip("live Acepe checkpoint schema", () => {
		// Two different reasons land here and they are not the same finding:
		// no database at all, versus a database whose checkpoints table is
		// empty. The second means the compatibility criterion is unprovable
		// until someone creates a checkpoint with the Rust build.
		Vitest.it("skipped: could not resolve an Acepe database on this machine", () => {})
	})
}

if (liveDatabaseExists && liveHasFileContent === false) {
	Vitest.describe.skip("live Acepe checkpoint file content", () => {
		Vitest.it("skipped: live Acepe database has no checkpoint file snapshots", () => {})
	})
}

if (liveFilename !== null) {
	const LiveReadonlySqlite = makeSqliteLayer({
		filename: liveFilename,
		readonly: true
	}).pipe(Layer.provideMerge(TestPlatform))

	Vitest.layer(LiveReadonlySqlite)("live Acepe checkpoint schema", (it) => {
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

	if (liveHasFileContent) {
		Vitest.layer(LiveReadonlySqlite)("live Acepe checkpoint file content", (it) => {
			it.effect("reads file content from a rust-written live checkpoint", () =>
				Effect.gen(function*() {
					const sql = yield* SqlClient.SqlClient
					const rows = yield* sql<{ id: string; session_id: string }>`
						SELECT id, session_id
						FROM checkpoints
						LIMIT 1
					`.withoutTransform
					if (!Arr.isReadonlyArrayNonEmpty(rows)) {
						Vitest.assert.fail("live checkpoints table is empty")
						return
					}
					const sessionId = SessionId.make(rows[0].session_id)
					const listed = yield* listStoredCheckpoints(sql, sessionId)
					const checkpoint = Arr.findFirst(listed, (row) => row.id === rows[0].id)
					if (Option.isNone(checkpoint)) {
						Vitest.assert.fail("live checkpoint is missing from listStoredCheckpoints")
						return
					}
					const snapshots = yield* sql<{ file_path: string }>`
						SELECT file_path
						FROM file_snapshots
						WHERE checkpoint_id = ${rows[0].id}
						LIMIT 1
					`.withoutTransform
					if (!Arr.isReadonlyArrayNonEmpty(snapshots)) {
						Vitest.assert.fail("live checkpoint has no file_snapshots")
						return
					}
					const content = yield* getStoredFileContent(
						sql,
						checkpoint.value.id,
						snapshots[0].file_path
					)
					Vitest.assert.isTrue(Option.isSome(content))
				})
			)
		})
	}
}
