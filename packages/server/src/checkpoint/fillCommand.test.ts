import {
	CheckpointCreateCommand,
	CheckpointId,
	CheckpointRevertCommand,
	CheckpointRevertFileCommand,
	CommandId,
	ProjectCreateCommand,
	ProjectId,
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
import * as Stream from "effect/Stream"
import { makeSqliteLayer } from "../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../persistence/Migrations.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import { fillCheckpointCommand } from "./fillCommand.ts"
import { CheckpointServiceLive } from "./Layers/CheckpointService.ts"
import { CheckpointService } from "./Services/CheckpointService.ts"

const commandId = CommandId.make("cmd-checkpoint")
const sessionId = SessionId.make("session-1")
const checkpointId = CheckpointId.make("checkpoint-1")
const ORIGINAL = "hello world"
const CHANGED = "changed"

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

const dispatched: Array<string> = []

const StubEngine = Layer.succeed(
	OrchestrationEngine,
	OrchestrationEngine.of({
		dispatch: (command) =>
			Effect.sync(() => {
				dispatched.push(command.type)
				return { sequence: 1 }
			}),
		streamDomainEvents: Stream.empty,
		latestSequence: Effect.succeed(0)
	})
)

const FillLive = CheckpointServiceLive.pipe(
	Layer.provideMerge(MigratedSqlite),
	Layer.provideMerge(StubEngine),
	Layer.provideMerge(PlatformLive)
)

const isolated = () => Layer.fresh(FillLive)

const emptyCreate = CheckpointCreateCommand.make({
	type: "checkpoint.create",
	commandId,
	sessionId,
	checkpointId,
	checkpointNumber: 1,
	name: "After edit",
	isAuto: false,
	toolCallId: null,
	fileCount: 1,
	projectPath: null,
	worktreePath: null,
	modifiedFiles: []
})

Vitest.layer(isolated())("fillCheckpointCommand", (it) => {
	it.effect("leaves non-checkpoint commands unchanged", () =>
		Effect.gen(function*() {
			const command = ProjectCreateCommand.make({
				type: "project.create",
				commandId,
				projectId: ProjectId.make("project-1"),
				title: "Acepe",
				workspaceRoot: "/tmp/acepe"
			})
			const filled = yield* fillCheckpointCommand(command)
			Vitest.assert.strictEqual(filled.type, "project.create")
		})
	)

	it.effect("skips persist when modifiedFiles is empty", () =>
		Effect.gen(function*() {
			const filled = yield* fillCheckpointCommand(emptyCreate)
			Vitest.assert.strictEqual(filled.type, "checkpoint.create")
			if (filled.type === "checkpoint.create") {
				Vitest.assert.strictEqual(filled.fileCount, 1)
				Vitest.assert.strictEqual(filled.checkpointNumber, 1)
			}
		})
	)

	it.effect("persists files and fills checkpointNumber and fileCount", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const checkpoints = yield* CheckpointService
			const persistSessionId = SessionId.make("session-persist")
			const persistCheckpointId = CheckpointId.make("checkpoint-persist")
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "hello.ts"), ORIGINAL)
			const filled = yield* fillCheckpointCommand(
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId: CommandId.make("cmd-persist"),
					sessionId: persistSessionId,
					checkpointId: persistCheckpointId,
					checkpointNumber: 1,
					name: "After edit",
					isAuto: false,
					toolCallId: null,
					fileCount: 1,
					projectPath: dir,
					worktreePath: null,
					modifiedFiles: ["hello.ts"]
				})
			)
			Vitest.assert.strictEqual(filled.type, "checkpoint.create")
			if (filled.type === "checkpoint.create") {
				Vitest.assert.strictEqual(filled.fileCount, 1)
				Vitest.assert.strictEqual(filled.checkpointNumber, 1)
			}
			const content = yield* checkpoints.getFileContent(
				persistSessionId,
				persistCheckpointId,
				"hello.ts"
			)
			Vitest.assert.strictEqual(content, ORIGINAL)
		})
	)

	it.effect("skips revert IO when projectPath is null", () =>
		Effect.gen(function*() {
			const filled = yield* fillCheckpointCommand(
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId,
					sessionId,
					checkpointId,
					projectPath: null,
					worktreePath: null
				})
			)
			Vitest.assert.strictEqual(filled.type, "checkpoint.revert")
		})
	)

	it.effect("restores files on revert and dispatches a safety checkpoint", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const revertSessionId = SessionId.make("session-revert")
			const revertCheckpointId = CheckpointId.make("checkpoint-revert")
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "hello.ts"), ORIGINAL)
			yield* fillCheckpointCommand(
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId: CommandId.make("cmd-create"),
					sessionId: revertSessionId,
					checkpointId: revertCheckpointId,
					checkpointNumber: 1,
					name: "After edit",
					isAuto: false,
					toolCallId: null,
					fileCount: 1,
					projectPath: dir,
					worktreePath: null,
					modifiedFiles: ["hello.ts"]
				})
			)
			yield* fs.writeFileString(path.join(dir, "hello.ts"), CHANGED)
			dispatched.length = 0
			const filled = yield* fillCheckpointCommand(
				CheckpointRevertCommand.make({
					type: "checkpoint.revert",
					commandId: CommandId.make("cmd-revert"),
					sessionId: revertSessionId,
					checkpointId: revertCheckpointId,
					projectPath: dir,
					worktreePath: null
				})
			)
			Vitest.assert.strictEqual(filled.type, "checkpoint.revert")
			Vitest.assert.strictEqual(yield* fs.readFileString(path.join(dir, "hello.ts")), ORIGINAL)
			Vitest.assert.deepStrictEqual(dispatched, [
				"checkpoint.create",
				"checkpoint.report-readiness"
			])
		})
	)

	it.effect("skips revert-file IO when projectPath is null", () =>
		Effect.gen(function*() {
			const filled = yield* fillCheckpointCommand(
				CheckpointRevertFileCommand.make({
					type: "checkpoint.revert-file",
					commandId,
					sessionId,
					checkpointId,
					filePath: "hello.ts",
					projectPath: null,
					worktreePath: null
				})
			)
			Vitest.assert.strictEqual(filled.type, "checkpoint.revert-file")
		})
	)

	it.effect("restores one file on revert-file", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "hello.ts"), ORIGINAL)
			yield* fillCheckpointCommand(
				CheckpointCreateCommand.make({
					type: "checkpoint.create",
					commandId: CommandId.make("cmd-create-file"),
					sessionId: SessionId.make("session-file"),
					checkpointId: CheckpointId.make("checkpoint-file-1"),
					checkpointNumber: 1,
					name: "After edit",
					isAuto: false,
					toolCallId: null,
					fileCount: 1,
					projectPath: dir,
					worktreePath: null,
					modifiedFiles: ["hello.ts"]
				})
			)
			yield* fs.writeFileString(path.join(dir, "hello.ts"), CHANGED)
			const filled = yield* fillCheckpointCommand(
				CheckpointRevertFileCommand.make({
					type: "checkpoint.revert-file",
					commandId: CommandId.make("cmd-revert-file"),
					sessionId: SessionId.make("session-file"),
					checkpointId: CheckpointId.make("checkpoint-file-1"),
					filePath: "hello.ts",
					projectPath: dir,
					worktreePath: null
				})
			)
			Vitest.assert.strictEqual(filled.type, "checkpoint.revert-file")
			Vitest.assert.strictEqual(yield* fs.readFileString(path.join(dir, "hello.ts")), ORIGINAL)
		})
	)
})
