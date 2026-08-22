import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import projectionVoice from "./0016_projection_voice.ts"

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

const VOICE_COLUMNS = [
	"voice_id",
	"models_json",
	"languages_json",
	"recording_json",
	"last_transcription_json",
	"sequence"
] as const

const isolatedSqlite = () => Layer.fresh(TempSqlite)

Vitest.layer(isolatedSqlite())("0016_projection_voice table", (it) => {
	it.effect("creates projection_voice keyed by voice_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionVoice
			const columns = yield* sql<{
				name: string
				pk: number
			}>`
				PRAGMA table_info(projection_voice)
			`.withoutTransform
			Vitest.assert.deepStrictEqual(
				columns.map((column) => column.name),
				[...VOICE_COLUMNS]
			)
			const keyColumn = columns.find((column) => column.name === "voice_id")
			Vitest.assert.isDefined(keyColumn)
			Vitest.assert.strictEqual(Number(keyColumn.pk), 1)
		})
	)
})

Vitest.layer(isolatedSqlite())("0016_projection_voice one row per aggregate", (it) => {
	it.effect("rejects a second row with the same voice_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionVoice
			yield* sql`
				INSERT INTO projection_voice (
					voice_id,
					models_json,
					languages_json,
					recording_json,
					last_transcription_json,
					sequence
				) VALUES (
					'app',
					'[]',
					'[]',
					'null',
					'null',
					1
				)
			`.withoutTransform
			const error = yield* sql`
				INSERT INTO projection_voice (
					voice_id,
					models_json,
					languages_json,
					recording_json,
					last_transcription_json,
					sequence
				) VALUES (
					'app',
					'[]',
					'[]',
					'null',
					'null',
					2
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0016_projection_voice sequence check", (it) => {
	it.effect("rejects a negative sequence", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionVoice
			const error = yield* sql`
				INSERT INTO projection_voice (
					voice_id,
					models_json,
					languages_json,
					recording_json,
					last_transcription_json,
					sequence
				) VALUES (
					'app',
					'[]',
					'[]',
					'null',
					'null',
					-1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})

Vitest.layer(isolatedSqlite())("0016_projection_voice empty voice_id", (it) => {
	it.effect("rejects an empty voice_id", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionVoice
			const error = yield* sql`
				INSERT INTO projection_voice (
					voice_id,
					models_json,
					languages_json,
					recording_json,
					last_transcription_json,
					sequence
				) VALUES (
					'',
					'[]',
					'[]',
					'null',
					'null',
					1
				)
			`.withoutTransform.pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SqlError")
		})
	)
})
