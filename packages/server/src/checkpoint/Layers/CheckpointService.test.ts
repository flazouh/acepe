import {
	CheckpointId,
	SessionId
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../../persistence/Migrations.ts"
import {
	CheckpointService,
	CreateCheckpointInput,
	RevertCheckpointInput
} from "../Services/CheckpointService.ts"
import { CheckpointServiceLive } from "./CheckpointService.ts"

const ORIGINAL = "hello world"
const CHANGED = "changed"
const sessionId = SessionId.make("session-1")
const decodeCreateInput = Schema.decodeUnknownEffect(CreateCheckpointInput)
const decodeRevertInput = Schema.decodeUnknownEffect(RevertCheckpointInput)

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

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, BunCrypto.layer)

const TestLive = CheckpointServiceLive.pipe(
	Layer.provideMerge(MigratedSqlite),
	Layer.provideMerge(PlatformLive)
)

const isolated = () => Layer.fresh(TestLive)

Vitest.layer(isolated())("CheckpointServiceLive persist-only create and revert", (it) => {
	it.effect("persists file blobs on create and restores them on revert", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const checkpoints = yield* CheckpointService
			const dir = yield* fs.makeTempDirectoryScoped()
			const filePath = path.join(dir, "hello.ts")
			yield* fs.writeFileString(filePath, ORIGINAL)
			const createInput = yield* decodeCreateInput({
				checkpointId: CheckpointId.make("checkpoint-1"),
				sessionId,
				projectPath: dir,
				worktreePath: null,
				modifiedFiles: ["hello.ts"],
				toolCallId: null,
				name: "After edit",
				isAuto: false
			})
			const record = yield* checkpoints.create(createInput)
			Vitest.assert.strictEqual(record.checkpointNumber, 1)
			Vitest.assert.strictEqual(record.fileCount, 1)
			const stored = yield* checkpoints.getFileContent(sessionId, record.id, "hello.ts")
			Vitest.assert.strictEqual(stored, ORIGINAL)
			const snapshots = yield* checkpoints.getFileSnapshots(sessionId, record.id)
			Vitest.assert.strictEqual(snapshots[0]?.content, ORIGINAL)
			yield* fs.writeFileString(filePath, CHANGED)
			const revertInput = yield* decodeRevertInput({
				sessionId,
				checkpointId: record.id,
				projectPath: dir,
				worktreePath: null
			})
			const reverted = yield* checkpoints.revert(revertInput)
			Vitest.assert.strictEqual(reverted.success, true)
			Vitest.assert.deepStrictEqual(reverted.revertedFiles, ["hello.ts"])
			Vitest.assert.strictEqual(yield* fs.readFileString(filePath), ORIGINAL)
		})
	)
})
