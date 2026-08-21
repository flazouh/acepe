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
import projectionSessionsPrLink from "./0013_projection_sessions_pr_link.ts"

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

const SESSION_COLUMNS = [
	"session_id",
	"project_id",
	"title",
	"provider",
	"created_at",
	"updated_at",
	"last_activity_at",
	"archived_at",
	"deleted_at",
	"pr_number",
	"pr_link_mode"
] as const

Vitest.layer(isolatedSqlite())("0013_projection_sessions_pr_link columns", (it) => {
	it.effect("adds nullable pr_number and pr_link_mode columns", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			yield* projectionSessionsPrLink
			const columns = yield* sql<{
				name: string
				notnull: number
			}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...SESSION_COLUMNS]
			)
			const prNumber = columns.find((column) => column.name === "pr_number")
			const prLinkMode = columns.find((column) => column.name === "pr_link_mode")
			Vitest.assert.isDefined(prNumber)
			Vitest.assert.isDefined(prLinkMode)
			Vitest.assert.strictEqual(Number(prNumber.notnull), 0)
			Vitest.assert.strictEqual(Number(prLinkMode.notnull), 0)
		})
	)
})
