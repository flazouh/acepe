import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer, resolveAcepeSqliteFilename } from "./Sqlite.ts"

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

const LiveReadonlySqlite = Layer.unwrap(
	Effect.gen(function*() {
		const filename = yield* resolveAcepeSqliteFilename
		return makeSqliteLayer({ filename, readonly: true })
	})
).pipe(Layer.provideMerge(TestPlatform))

const pathEnvLayer = (env: Record<string, string>, exists: (candidate: string) => boolean) =>
	Layer.mergeAll(
		Path.layer,
		Layer.succeed(
			FileSystem.FileSystem,
			FileSystem.makeNoop({
				exists: (candidate) => Effect.succeed(exists(candidate))
			})
		),
		ConfigProvider.layer(ConfigProvider.fromEnv({ env }))
	)

Vitest.layer(pathEnvLayer({ HOME: "/Users/alex" }, (candidate) =>
	candidate === "/Users/alex/Library/Application Support"
))("macOS Acepe app-data path", (it) => {
	it.effect("uses Application Support/Acepe/acepe_dev.db", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const filename = yield* resolveAcepeSqliteFilename
			Vitest.assert.strictEqual(
				filename,
				path.join("/Users/alex", "Library", "Application Support", "Acepe", "acepe_dev.db")
			)
		})
	)
})

Vitest.layer(pathEnvLayer({ HOME: "/Users/alex", ACEPE_ENV: "production" }, (candidate) =>
	candidate === "/Users/alex/Library/Application Support"
))("ACEPE_ENV production", (it) => {
	it.effect("uses acepe.db", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const filename = yield* resolveAcepeSqliteFilename
			Vitest.assert.strictEqual(
				filename,
				path.join("/Users/alex", "Library", "Application Support", "Acepe", "acepe.db")
			)
		})
	)
})

Vitest.layer(
	pathEnvLayer({ HOME: "/Users/alex", ACEPE_BUNDLE_IDENTIFIER: "com.alex.acepe.staging" }, (candidate) =>
		candidate === "/Users/alex/Library/Application Support"
	)
)("staging bundle identifier", (it) => {
	it.effect("uses acepe_staging.db", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const filename = yield* resolveAcepeSqliteFilename
			Vitest.assert.strictEqual(
				filename,
				path.join("/Users/alex", "Library", "Application Support", "Acepe", "acepe_staging.db")
			)
		})
	)
})

Vitest.layer(pathEnvLayer({ LOCALAPPDATA: "C:\\Users\\alex\\AppData\\Local" }, () => false))(
	"Windows LOCALAPPDATA",
	(it) => {
		it.effect("uses the LocalAppData Acepe file", () =>
			Effect.gen(function*() {
				const path = yield* Path.Path
				const filename = yield* resolveAcepeSqliteFilename
				Vitest.assert.strictEqual(
					filename,
					path.join("C:\\Users\\alex\\AppData\\Local", "Acepe", "acepe_dev.db")
				)
			})
		)
	}
)

Vitest.layer(pathEnvLayer({ HOME: "/home/alex", XDG_DATA_HOME: "/var/data" }, () => false))(
	"Linux XDG_DATA_HOME",
	(it) => {
		it.effect("uses the XDG data dir Acepe file", () =>
			Effect.gen(function*() {
				const path = yield* Path.Path
				const filename = yield* resolveAcepeSqliteFilename
				Vitest.assert.strictEqual(filename, path.join("/var/data", "Acepe", "acepe_dev.db"))
			})
		)
	}
)

Vitest.layer(TempSqlite)("makeSqliteLayer", (it) => {
	it.effect("sets WAL mode and foreign_keys=ON on connect", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const journalRows = yield* sql<{ journal_mode: string }>`PRAGMA journal_mode`.withoutTransform
			const foreignKeyRows = yield* sql<{
				foreign_keys: number
			}>`PRAGMA foreign_keys`.withoutTransform
			const journal = journalRows[0]
			const foreignKeys = foreignKeyRows[0]
			Vitest.assert.isDefined(journal)
			Vitest.assert.isDefined(foreignKeys)
			Vitest.assert.strictEqual(journal.journal_mode.toLowerCase(), "wal")
			Vitest.assert.strictEqual(Number(foreignKeys.foreign_keys), 1)
		})
	)
})

// The live database only exists on a machine that has actually run Acepe.
// CI and fresh clones must skip this suite rather than fail on its absence.
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

if (!liveDatabaseExists) {
	Vitest.describe.skip("live Acepe database", () => {
		Vitest.it("skipped: no Acepe database on this machine", () => {})
	})
}

const describeLive = liveDatabaseExists
	? Vitest.layer(LiveReadonlySqlite)
	: (_name: string, _suite: unknown) => {}

describeLive("live Acepe database", (it) => {
	it.effect("opens the live database read-only and selects from projects", () =>
		Effect.gen(function*() {
			const filename = yield* resolveAcepeSqliteFilename
			const fs = yield* FileSystem.FileSystem
			const exists = yield* fs.exists(filename)
			Vitest.assert.isTrue(exists)
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ id: string }>`SELECT id FROM projects LIMIT 1`.withoutTransform
			Vitest.assert.isArray(rows)
		})
	)
})
