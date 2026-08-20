import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"

export type SqliteOpenOptions = {
	readonly filename: string
	readonly readonly: boolean
}

const APP_FOLDER = "Acepe"
const BUSY_TIMEOUT = Duration.seconds(2)

const sqliteFileNameFromAcepeEnv = (acepeEnv: string): Option.Option<string> => {
	switch (acepeEnv) {
		case "staging":
			return Option.some("acepe_staging.db")
		case "dev":
		case "development":
			return Option.some("acepe_dev.db")
		case "production":
		case "prod":
			return Option.some("acepe.db")
		default:
			return Option.none()
	}
}

const sqliteFileNameFromBundleIdentifier = (bundleIdentifier: Option.Option<string>): string =>
	Option.match(bundleIdentifier, {
		onNone: () => "acepe_dev.db",
		onSome: (identifier) => (identifier.endsWith(".staging") ? "acepe_staging.db" : "acepe_dev.db")
	})

const acepeSqliteFileName = (
	acepeEnv: Option.Option<string>,
	bundleIdentifier: Option.Option<string>
): string =>
	Option.match(Option.flatMap(acepeEnv, sqliteFileNameFromAcepeEnv), {
		onNone: () => sqliteFileNameFromBundleIdentifier(bundleIdentifier),
		onSome: (fileName) => fileName
	})

const resolveDataLocalDir = Effect.gen(function* () {
	const path = yield* Path.Path
	const fs = yield* FileSystem.FileSystem
	const localAppData = yield* Config.option(Config.string("LOCALAPPDATA"))
	if (Option.isSome(localAppData)) {
		return localAppData.value
	}
	const home = yield* Config.string("HOME").pipe(Config.orElse(() => Config.string("USERPROFILE")))
	const macOsDir = path.join(home, "Library", "Application Support")
	const macOsDirExists = yield* fs.exists(macOsDir)
	if (macOsDirExists) {
		return macOsDir
	}
	const xdgDataHome = yield* Config.option(Config.string("XDG_DATA_HOME"))
	return Option.match(xdgDataHome, {
		onNone: () => path.join(home, ".local", "share"),
		onSome: (dir) => dir
	})
})

export const resolveAcepeSqliteFilename = Effect.gen(function* () {
	const path = yield* Path.Path
	const acepeEnv = yield* Config.option(Config.string("ACEPE_ENV"))
	const bundleIdentifier = yield* Config.option(Config.string("ACEPE_BUNDLE_IDENTIFIER"))
	const dataLocalDir = yield* resolveDataLocalDir
	return path.join(dataLocalDir, APP_FOLDER, acepeSqliteFileName(acepeEnv, bundleIdentifier))
})

const applyConnectionPragmas = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`PRAGMA journal_mode = WAL`.withoutTransform
	yield* sql`PRAGMA foreign_keys = ON`.withoutTransform
})

const sqliteClientLayer = (options: SqliteOpenOptions): Layer.Layer<
	SqliteClient.SqliteClient | SqlClient.SqlClient
> => {
	if (options.readonly) {
		return SqliteClient.layer({
			filename: options.filename,
			readonly: true,
			create: false,
			readwrite: false,
			busyTimeout: BUSY_TIMEOUT
		})
	}
	return SqliteClient.layer({
		filename: options.filename,
		create: true,
		busyTimeout: BUSY_TIMEOUT
	})
}

export const makeSqliteLayer = (options: SqliteOpenOptions) =>
	Layer.effectDiscard(applyConnectionPragmas).pipe(Layer.provideMerge(sqliteClientLayer(options)))

export const SqliteLive = Layer.unwrap(
	Effect.gen(function* () {
		const filename = yield* resolveAcepeSqliteFilename
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		yield* fs.makeDirectory(path.dirname(filename), { recursive: true })
		return makeSqliteLayer({ filename, readonly: false })
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))
