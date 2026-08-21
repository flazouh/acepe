import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as TestClock from "effect/testing/TestClock"
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts"
import { OrchestrationCommandReceiptsLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts"
import { ProjectionSessionMessagesLive } from "../persistence/Layers/ProjectionSessionMessages.ts"
import { ProjectionSessionsLive } from "../persistence/Layers/ProjectionSessions.ts"
import { ProjectionStateLive } from "../persistence/Layers/ProjectionState.ts"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../persistence/Migrations.ts"

export const HISTORY_TEST_NOW = "2026-08-21T12:00:00.000Z"

export const setHistoryClock = Effect.fn("setHistoryClock")(function*(iso: string) {
	const made = DateTime.make(iso)
	if (Option.isNone(made)) {
		return
	}
	yield* TestClock.setTime(made.value.pipe(DateTime.toEpochMillis))
})

export const HistoryPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

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
).pipe(Layer.provide(HistoryPlatform))

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionSessionsLive,
	ProjectionSessionMessagesLive
).pipe(Layer.provideMerge(MigratedSqlite))

export const HistoryEngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)
