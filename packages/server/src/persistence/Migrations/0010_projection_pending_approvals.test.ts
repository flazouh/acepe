import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionPendingApprovals from "./0010_projection_pending_approvals.ts"

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

const APPROVAL_COLUMNS = ["approval_request_id", "session_id", "sequence"] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0010_projection_pending_approvals table", (it) => {
	it.effect("creates projection_pending_approvals keyed by approval_request_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionPendingApprovals
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_pending_approvals)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...APPROVAL_COLUMNS]
			)
			const idColumn = columns.find((column) => column.name === "approval_request_id")
			Vitest.assert.isDefined(idColumn)
			Vitest.assert.strictEqual(Number(idColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0010_projection_pending_approvals snapshot columns", (it) => {
	it.effect("accepts an insert of only approval_request_id, session_id, and sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionPendingApprovals
			yield* sql`
				INSERT INTO projection_pending_approvals (approval_request_id, session_id, sequence)
				VALUES ('approval-1', 'session-1', 5)
			`.withoutTransform
			const rows = yield* sql<{
				approval_request_id: string
				session_id: string
				sequence: number
			}>`
				SELECT approval_request_id, session_id, sequence
				FROM projection_pending_approvals
			`.withoutTransform
			Vitest.assert.strictEqual(rows[0]?.approval_request_id, "approval-1")
			Vitest.assert.strictEqual(rows[0]?.session_id, "session-1")
			Vitest.assert.strictEqual(Number(rows[0]?.sequence), 5)
		})
	)
})

Vitest.layer(isolatedSqlite())("0010_projection_pending_approvals one row per request", (it) => {
	it.effect("rejects a second row with the same approval_request_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionPendingApprovals
			yield* sql`
				INSERT INTO projection_pending_approvals (approval_request_id, session_id, sequence)
				VALUES ('approval-1', 'session-1', 5)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_pending_approvals (approval_request_id, session_id, sequence)
				VALUES ('approval-1', 'session-1', 6)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
