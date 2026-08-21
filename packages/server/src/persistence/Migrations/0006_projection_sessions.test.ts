import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionSessions from "./0006_projection_sessions.ts"

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

const SESSION_COLUMNS = [
	"session_id",
	"project_id",
	"title",
	"provider",
	"created_at",
	"updated_at",
	"last_activity_at",
	"archived_at",
	"deleted_at"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0006_projection_sessions table", (it) => {
	it.effect("creates projection_sessions keyed by session_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			const columns = yield* sql<{
				name: string
				pk: number
				notnull: number
			}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...SESSION_COLUMNS]
			)
			const sessionIdColumn = columns.find((column) => column.name === "session_id")
			Vitest.assert.isDefined(sessionIdColumn)
			Vitest.assert.strictEqual(Number(sessionIdColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0006_projection_sessions archived and deleted columns", (it) => {
	it.effect("allows archived_at, deleted_at, and provider to be null", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			const columns = yield* sql<{
				name: string
				notnull: number
			}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform
			const archived = columns.find((column) => column.name === "archived_at")
			const deleted = columns.find((column) => column.name === "deleted_at")
			const provider = columns.find((column) => column.name === "provider")
			Vitest.assert.isDefined(archived)
			Vitest.assert.isDefined(deleted)
			Vitest.assert.isDefined(provider)
			Vitest.assert.strictEqual(Number(archived.notnull), 0)
			Vitest.assert.strictEqual(Number(deleted.notnull), 0)
			Vitest.assert.strictEqual(Number(provider.notnull), 0)
		})
	)
})

Vitest.layer(isolatedSqlite())("0006_projection_sessions one row per session", (it) => {
	it.effect("rejects a second row with the same session_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			yield* sql`
				INSERT INTO projection_sessions (
					session_id,
					project_id,
					title,
					provider,
					created_at,
					updated_at,
					last_activity_at,
					archived_at,
					deleted_at
				) VALUES (
					'session-1',
					'project-1',
					'First session',
					NULL,
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					NULL,
					NULL
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_sessions (
					session_id,
					project_id,
					title,
					provider,
					created_at,
					updated_at,
					last_activity_at,
					archived_at,
					deleted_at
				) VALUES (
					'session-1',
					'project-1',
					'Duplicate session',
					NULL,
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					NULL,
					NULL
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
