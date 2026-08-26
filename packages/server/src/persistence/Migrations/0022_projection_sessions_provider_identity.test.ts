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
import projectionSessionsProviderIdentity from "./0022_projection_sessions_provider_identity.ts"

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

Vitest.layer(isolatedSqlite())("0022_projection_sessions_provider_identity columns", (it) => {
	it.effect("adds a nullable provider_session_id column and a defaulted provider_session_failed flag", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			yield* projectionSessions
			yield* projectionSessionsProviderIdentity
			const columns = yield* sql<{
				name: string
				notnull: number
				dflt_value: string | null
			}>`
				PRAGMA table_info(projection_sessions)
			`.withoutTransform
			const providerSessionId = columns.find((column) => column.name === "provider_session_id")
			const providerSessionFailed = columns.find(
				(column) => column.name === "provider_session_failed"
			)
			Vitest.assert.isDefined(providerSessionId)
			Vitest.assert.isDefined(providerSessionFailed)
			Vitest.assert.strictEqual(Number(providerSessionId.notnull), 0)
			Vitest.assert.strictEqual(Number(providerSessionFailed.notnull), 1)
			Vitest.assert.strictEqual(providerSessionFailed.dflt_value, "0")
		})
	)
})
