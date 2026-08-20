import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import commandReceipts from "./0004_command_receipts.ts"

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

const RECEIPT_COLUMNS = ["command_id", "status", "result_sequence", "reason"] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0004_command_receipts table", (it) => {
	it.effect("creates orchestration_command_receipts keyed by command_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* commandReceipts
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(orchestration_command_receipts)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...RECEIPT_COLUMNS]
			)
			const commandIdColumn = columns.find((column) => column.name === "command_id")
			Vitest.assert.isDefined(commandIdColumn)
			Vitest.assert.strictEqual(Number(commandIdColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0004_command_receipts accepted and rejected rows", (it) => {
	it.effect("stores accepted-with-sequence and rejected-with-reason rows", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* commandReceipts
			yield* sql`
				INSERT INTO orchestration_command_receipts (
					command_id,
					status,
					result_sequence,
					reason
				) VALUES (
					'cmd-accepted',
					'accepted',
					3,
					NULL
				)
			`.withoutTransform
			yield* sql`
				INSERT INTO orchestration_command_receipts (
					command_id,
					status,
					result_sequence,
					reason
				) VALUES (
					'cmd-rejected',
					'rejected',
					NULL,
					'project already exists'
				)
			`.withoutTransform
			const rows = yield* sql<{
				command_id: string
				status: string
				result_sequence: number | null
				reason: string | null
			}>`
				SELECT command_id, status, result_sequence, reason
				FROM orchestration_command_receipts
				ORDER BY command_id
			`.withoutTransform
			Vitest.assert.deepStrictEqual(rows, [
				{
					command_id: "cmd-accepted",
					status: "accepted",
					result_sequence: 3,
					reason: null
				},
				{
					command_id: "cmd-rejected",
					status: "rejected",
					result_sequence: null,
					reason: "project already exists"
				}
			])
		})
	)
})

Vitest.layer(isolatedSqlite())("0004_command_receipts accepted invariant", (it) => {
	it.effect("rejects an accepted row that is missing a sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* commandReceipts
			const error = yield* sql`
				INSERT INTO orchestration_command_receipts (
					command_id,
					status,
					result_sequence,
					reason
				) VALUES (
					'cmd-bad',
					'accepted',
					NULL,
					NULL
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0004_command_receipts rejected invariant", (it) => {
	it.effect("rejects a rejected row that is missing a reason", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* commandReceipts
			const error = yield* sql`
				INSERT INTO orchestration_command_receipts (
					command_id,
					status,
					result_sequence,
					reason
				) VALUES (
					'cmd-bad',
					'rejected',
					NULL,
					NULL
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
