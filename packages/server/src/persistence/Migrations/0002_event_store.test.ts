import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import eventStore from "./0002_event_store.ts"

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

const ENVELOPE_COLUMNS = [
	"sequence",
	"event_id",
	"aggregate_kind",
	"aggregate_id",
	"occurred_at",
	"command_id",
	"causation_event_id",
	"correlation_id",
	"metadata",
	"type",
	"payload"
] as const

Vitest.layer(TempSqlite)("0002_event_store", (it) => {
	it.effect("creates orchestration_events with envelope columns and indexes", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* eventStore
			const columns = yield* sql<{ name: string }>`
				PRAGMA table_info(orchestration_events)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...ENVELOPE_COLUMNS]
			)
			const indexes = yield* sql<{
				name: string
				unique: number
			}>`
				PRAGMA index_list(orchestration_events)
			`.withoutTransform
			const eventIdIndex = indexes.find((index) => index.name === "orchestration_events_event_id_idx")
			const aggregateIndex = indexes.find((index) =>
				index.name === "orchestration_events_aggregate_sequence_idx"
			)
			Vitest.assert.isDefined(eventIdIndex)
			Vitest.assert.strictEqual(Number(eventIdIndex.unique), 1)
			Vitest.assert.isDefined(aggregateIndex)
			const aggregateColumns = yield* sql<{ name: string }>`
				PRAGMA index_info(orchestration_events_aggregate_sequence_idx)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				aggregateColumns.map((column) => column.name),
				["aggregate_kind", "aggregate_id", "sequence"]
			)
		})
	)
})
