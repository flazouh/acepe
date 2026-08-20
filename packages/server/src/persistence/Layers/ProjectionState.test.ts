import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { runMigrations } from "../Migrations.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

class ForcedRollback extends Schema.TaggedError<ForcedRollback>()("ForcedRollback", {}) {}

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

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const TestProjectionState = ProjectionStateLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedProjectionState = () => Layer.fresh(TestProjectionState)

Vitest.layer(isolatedProjectionState())("lastApplied for a name that has never run", (it) => {
	it.effect("returns sequence 0", () =>
		Effect.gen(function*() {
			const state = yield* ProjectionState
			const sequence = yield* state.lastApplied("projection.sessions")
			Vitest.assert.strictEqual(sequence, 0)
		})
	)
})

Vitest.layer(isolatedProjectionState())("checkpoint then lastApplied", (it) => {
	it.effect("stores the last applied sequence for that projector", () =>
		Effect.gen(function*() {
			const state = yield* ProjectionState
			yield* state.checkpoint("projection.sessions", 12)
			const sequence = yield* state.lastApplied("projection.sessions")
			Vitest.assert.strictEqual(sequence, 12)
		})
	)
})

Vitest.layer(isolatedProjectionState())("reset one projector to sequence 0", (it) => {
	it.effect("rebuilds only that projector on the next lastApplied", () =>
		Effect.gen(function*() {
			const state = yield* ProjectionState
			yield* state.checkpoint("projection.sessions", 8)
			yield* state.checkpoint("projection.session-messages", 15)
			yield* state.checkpoint("projection.sessions", 0)
			const sessions = yield* state.lastApplied("projection.sessions")
			const messages = yield* state.lastApplied("projection.session-messages")
			Vitest.assert.strictEqual(sessions, 0)
			Vitest.assert.strictEqual(messages, 15)
		})
	)
})

Vitest.layer(isolatedProjectionState())("checkpoint is transactional", (it) => {
	it.effect("rolls back when the surrounding transaction fails", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const state = yield* ProjectionState
			yield* state.checkpoint("projection.sessions", 4)
			const error = yield* sql.withTransaction(
				Effect.gen(function*() {
					yield* state.checkpoint("projection.sessions", 9)
					return yield* new ForcedRollback()
				})
			).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "ForcedRollback")
			const sequence = yield* state.lastApplied("projection.sessions")
			Vitest.assert.strictEqual(sequence, 4)
		})
	)
})
