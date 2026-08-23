import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionGitReview from "./0017_projection_git_review.ts"

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

const GIT_COLUMNS = ["project_id", "status_json", "files_json", "sequence"] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0017_projection_git_review table", (it) => {
	it.effect("creates projection_git_review keyed by project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionGitReview
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_git_review)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...GIT_COLUMNS]
			)
			const keyColumn = columns.find((column) => column.name === "project_id")
			Vitest.assert.isDefined(keyColumn)
			Vitest.assert.strictEqual(Number(keyColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0017_projection_git_review one row per project", (it) => {
	it.effect("rejects a second row with the same project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionGitReview
			yield* sql`
				INSERT INTO projection_git_review (
					project_id,
					status_json,
					files_json,
					sequence
				) VALUES (
					'project-1',
					'null',
					'[]',
					1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_git_review (
					project_id,
					status_json,
					files_json,
					sequence
				) VALUES (
					'project-1',
					'null',
					'[]',
					2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0017_projection_git_review sequence check", (it) => {
	it.effect("rejects a negative sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionGitReview
			const error = yield* sql`
				INSERT INTO projection_git_review (
					project_id,
					status_json,
					files_json,
					sequence
				) VALUES (
					'project-1',
					'null',
					'[]',
					-1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0017_projection_git_review empty project_id", (it) => {
	it.effect("rejects an empty project_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionGitReview
			const error = yield* sql`
				INSERT INTO projection_git_review (
					project_id,
					status_json,
					files_json,
					sequence
				) VALUES (
					'',
					'null',
					'[]',
					1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
