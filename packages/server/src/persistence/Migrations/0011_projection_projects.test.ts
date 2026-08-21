import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionProjects from "./0011_projection_projects.ts"

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

const PROJECT_COLUMNS = [
	"project_id",
	"title",
	"workspace_root",
	"created_at",
	"updated_at",
	"deleted_at",
	"session_count",
	"scan_warmed_at"
] as const

const MEMBERSHIP_COLUMNS = ["session_id", "project_id", "deleted_at"] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0011_projection_projects table", (it) => {
	it.effect("creates projection_projects keyed by project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_projects)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...PROJECT_COLUMNS]
			)
			const projectIdColumn = columns.find((column) => column.name === "project_id")
			Vitest.assert.isDefined(projectIdColumn)
			Vitest.assert.strictEqual(Number(projectIdColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0011_projection_projects session_count", (it) => {
	it.effect("defaults session_count to 0 and stores it on the project row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			yield* sql`
				INSERT INTO projection_projects (
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					scan_warmed_at
				) VALUES (
					'project-1',
					'Acepe',
					'/tmp/acepe',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z'
				)
			`.withoutTransform
			const rows = yield* sql<{
				project_id: string
				session_count: number
				scan_warmed_at: string
			}>`
				SELECT project_id, session_count, scan_warmed_at
				FROM projection_projects
			`.withoutTransform
			Vitest.assert.strictEqual(rows[0]?.project_id, "project-1")
			Vitest.assert.strictEqual(Number(rows[0]?.session_count), 0)
			Vitest.assert.strictEqual(rows[0]?.scan_warmed_at, "2026-08-20T12:00:00.000Z")
		})
	)
})

Vitest.layer(isolatedSqlite())("0011_projection_projects one row per project", (it) => {
	it.effect("rejects a second row with the same project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			yield* sql`
				INSERT INTO projection_projects (
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					scan_warmed_at
				) VALUES (
					'project-1',
					'Acepe',
					'/tmp/acepe',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z'
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_projects (
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					scan_warmed_at
				) VALUES (
					'project-1',
					'Duplicate',
					'/tmp/other',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z'
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0011_projection_projects session_count check", (it) => {
	it.effect("rejects a negative session_count", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			const error = yield* sql`
				INSERT INTO projection_projects (
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					session_count,
					scan_warmed_at
				) VALUES (
					'project-1',
					'Acepe',
					'/tmp/acepe',
					'2026-08-20T12:00:00.000Z',
					'2026-08-20T12:00:00.000Z',
					-1,
					'2026-08-20T12:00:00.000Z'
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0011_projection_projects_membership table", (it) => {
	it.effect("creates membership keyed by session_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionProjects
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_projects_membership)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...MEMBERSHIP_COLUMNS]
			)
			const sessionIdColumn = columns.find((column) => column.name === "session_id")
			Vitest.assert.isDefined(sessionIdColumn)
			Vitest.assert.strictEqual(Number(sessionIdColumn.pk), 1)
		})
	)
})
