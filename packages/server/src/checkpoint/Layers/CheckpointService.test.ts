import {
	CheckpointId,
	CommandId,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import { OrchestrationCommandReceiptsLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts"
import { ProjectionCheckpointsLive } from "../../persistence/Layers/ProjectionCheckpoints.ts"
import { ProjectionStateLive } from "../../persistence/Layers/ProjectionState.ts"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../../persistence/Migrations.ts"
import { ProjectionCheckpoints } from "../../persistence/Services/ProjectionCheckpoints.ts"
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts"
import {
	CheckpointService,
	CreateCheckpointInput,
	RevertCheckpointInput
} from "../Services/CheckpointService.ts"
import { CheckpointServiceLive } from "./CheckpointService.ts"

const ORIGINAL = "hello world"
const CHANGED = "changed"
const projectId = ProjectId.make("project-1")
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

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionCheckpointsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, BunCrypto.layer)

const TestLive = CheckpointServiceLive.pipe(
	Layer.provideMerge(EngineLive),
	Layer.provideMerge(PlatformLive)
)

const isolated = () => Layer.fresh(TestLive)

const projectorOf = (checkpoints: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: checkpoints.name,
	apply: checkpoints.apply,
	truncate: checkpoints.truncate
})

const withPipeline = <A, E, R>(
	projectors: ReadonlyArray<ProjectorDefinition>,
	body: Effect.Effect<A, E, R>
) =>
	Effect.scoped(
		body.pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(Layer.fresh(ProjectionPipelineLive(projectors)))
		)
	)

const waitForSequence = Effect.fn("waitForSequence")(function*(name: string, sequence: number) {
	const state = yield* ProjectionState
	const pipeline = yield* ProjectionPipeline
	let spins = 0
	while (true) {
		const current = yield* state.lastApplied(name)
		if (current === sequence) {
			return
		}
		spins = spins + 1
		if (spins > 200) {
			const health = yield* pipeline.health(name)
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for sequence ${sequence}; lastApplied=${current}; health=${health}.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
})

const seedSession = Effect.fn("seedSession")(function*(workspaceRoot: string) {
	const engine = yield* OrchestrationEngine
	yield* engine.dispatch(
		ProjectCreateCommand.make({
			type: "project.create",
			commandId: CommandId.make("cmd-project"),
			projectId,
			title: "Acepe",
			workspaceRoot
		})
	)
	yield* engine.dispatch(
		SessionCreateCommand.make({
			type: "session.create",
			commandId: CommandId.make("cmd-session"),
			sessionId,
			projectId,
			title: "First session"
		})
	)
})

const requireProjected = Effect.fn("requireProjected")(function*(checkpointId: CheckpointId) {
	const projection = yield* ProjectionCheckpoints
	const row = yield* projection.get(checkpointId)
	return Option.match(row, {
		onNone: () => {
			Vitest.assert.fail(`expected projected checkpoint ${checkpointId}`)
			return undefined as never
		},
		onSome: (value) => value
	})
})

Vitest.layer(isolated())("CheckpointServiceLive create and revert", (it) => {
	it.effect("reverts files through checkpoint.revert and sets lastRevertedAt", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const checkpoints = yield* CheckpointService
			const projection = yield* ProjectionCheckpoints
			const dir = yield* fs.makeTempDirectoryScoped()
			const filePath = path.join(dir, "hello.ts")
			yield* fs.writeFileString(filePath, ORIGINAL)
			const createInput = yield* decodeCreateInput({
				sessionId,
				projectPath: dir,
				worktreePath: null,
				modifiedFiles: ["hello.ts"],
				toolCallId: null,
				name: "After edit",
				isAuto: false
			})
			yield* withPipeline(
				[projectorOf(projection)],
				Effect.gen(function*() {
					yield* seedSession(dir)
					yield* waitForSequence(projection.name, 2)
					const record = yield* checkpoints.create(createInput)
					yield* waitForSequence(projection.name, 4)
					const created = yield* requireProjected(record.id)
					Vitest.assert.strictEqual(record.checkpointNumber, 1)
					Vitest.assert.strictEqual(record.fileCount, 1)
					const stored = yield* checkpoints.getFileContent(sessionId, record.id, "hello.ts")
					Vitest.assert.strictEqual(stored, ORIGINAL)
					Vitest.assert.strictEqual(created.status, "ready")
					Vitest.assert.strictEqual(created.lastRevertedAt, null)
					yield* fs.writeFileString(filePath, CHANGED)
					const revertInput = yield* decodeRevertInput({
						sessionId,
						checkpointId: record.id,
						projectPath: dir,
						worktreePath: null
					})
					const reverted = yield* checkpoints.revert(revertInput)
					yield* waitForSequence(projection.name, 7)
					Vitest.assert.strictEqual(reverted.success, true)
					Vitest.assert.deepStrictEqual(reverted.revertedFiles, ["hello.ts"])
					Vitest.assert.strictEqual(yield* fs.readFileString(filePath), ORIGINAL)
					const afterRevert = yield* requireProjected(record.id)
					Vitest.assert.strictEqual(afterRevert.status, "ready")
					Vitest.assert.notStrictEqual(afterRevert.lastRevertedAt, null)
					const listed = yield* projection.listBySession(sessionId)
					Vitest.assert.strictEqual(listed.length, 2)
				})
			)
		})
	)
})
