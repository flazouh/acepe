import {
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectCreateCommand,
	ProjectId,
	Sequence,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationCommandReceiptsLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts"
import { ProjectionStateLive } from "../../persistence/Layers/ProjectionState.ts"
import { makeSqliteLayer } from "../../persistence/Layers/Sqlite.ts"
import { runMigrations } from "../../persistence/Migrations.ts"
import {
	type NewOrchestrationEvent,
	OrchestrationEventStore
} from "../../persistence/Services/OrchestrationEventStore.ts"
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts"
import { OrchestrationEngineLive } from "../Layers/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../Services/OrchestrationEngine.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline,
	ProjectionUnknownError
} from "../Services/ProjectionPipeline.ts"
import { ProjectionPipelineLive } from "./ProjectionPipeline.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const ProjectionTestRow = Schema.Struct({
	projector: Schema.String,
	sequence: Sequence,
	event_id: Schema.String
})
const decodeProjectionTestRows = Schema.decodeUnknownEffect(Schema.Array(ProjectionTestRow))

const projectCreated = (index: number): NewOrchestrationEvent => ({
	eventId: EventId.make(`event-${index}`),
	aggregateKind: "project",
	aggregateId: ProjectId.make(`project-${index}`),
	occurredAt,
	commandId: CommandId.make(`cmd-seed-${index}`),
	causationEventId: null,
	correlationId: CommandId.make(`cmd-seed-${index}`),
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId: ProjectId.make(`project-${index}`),
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
})

const seedEvents = (count: number) =>
	Arr.map(Arr.range(1, count), (index) => projectCreated(index))

const createProjectCommand = (commandId: string, projectId: string) =>
	ProjectCreateCommand.make({
		type: "project.create",
		commandId: CommandId.make(commandId),
		projectId: ProjectId.make(projectId),
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	})

const createTestTable = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_pipeline_test (
			projector TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			event_id TEXT NOT NULL,
			PRIMARY KEY (projector, sequence)
		)
	`.withoutTransform
})

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

const SqliteWithTable = Layer.effectDiscard(createTestTable).pipe(Layer.provideMerge(MigratedSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive
).pipe(Layer.provideMerge(SqliteWithTable))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const tableProjector = (
	name: TrimmedNonEmptyString,
	hooks?: {
		readonly beforeApply?: (
			event: OrchestrationEvent
		) => Effect.Effect<void, ProjectionApplyError>
		readonly afterWrite?: (
			event: OrchestrationEvent
		) => Effect.Effect<void, ProjectionApplyError>
	}
): ProjectorDefinition => ({
	name,
	apply: (event, tx) =>
		Effect.gen(function*() {
			if (hooks !== undefined && hooks.beforeApply !== undefined) {
				yield* hooks.beforeApply(event)
			}
			yield* tx`
				INSERT INTO projection_pipeline_test (projector, sequence, event_id)
				VALUES (${name}, ${event.sequence}, ${event.eventId})
			`.withoutTransform
			if (hooks !== undefined && hooks.afterWrite !== undefined) {
				yield* hooks.afterWrite(event)
			}
		}),
	truncate: (tx) =>
		tx`
			DELETE FROM projection_pipeline_test WHERE projector = ${name}
		`.withoutTransform.pipe(Effect.asVoid)
})

const readProjected = Effect.fn("readProjected")(function*(name: string) {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT projector, sequence, event_id
		FROM projection_pipeline_test
		WHERE projector = ${name}
		ORDER BY sequence ASC
	`.withoutTransform
	return yield* decodeProjectionTestRows(rows)
})

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
			const rows = yield* readProjected(name)
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for sequence ${sequence}; lastApplied=${current}; health=${health}; rows=${rows.length}.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
})

const waitForHealth = Effect.fn("waitForHealth")(function*(
	name: string,
	expected: "healthy" | "degraded"
) {
	const pipeline = yield* ProjectionPipeline
	let spins = 0
	while (true) {
		const current = yield* pipeline.health(name)
		if (current === expected) {
			return
		}
		spins = spins + 1
		if (spins > 10_000) {
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for health '${expected}'.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
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

Vitest.layer(isolatedEngine())("catch-up to live handover", (it) => {
	it.effect("does not drop or double-apply an event at the catch-up to live seam", () =>
		Effect.gen(function*() {
			const name = yield* decodeName("projection.alpha")
			const store = yield* OrchestrationEventStore
			const engine = yield* OrchestrationEngine
			yield* store.append(seedEvents(20))
			yield* withPipeline(
				[
					tableProjector(name, {
						afterWrite: () => Effect.yieldNow
					})
				],
				Effect.gen(function*() {
					yield* Effect.forEach(
						Arr.range(21, 25),
						(index) =>
							engine.dispatch(
								createProjectCommand(`cmd-live-${index}`, `project-live-${index}`)
							),
						{ concurrency: "unbounded" }
					)
					yield* waitForSequence(name, 25)
					const pipeline = yield* ProjectionPipeline
					const health = yield* pipeline.health(name)
					const rows = yield* readProjected(name)
					Vitest.assert.strictEqual(health, "healthy")
					Vitest.assert.deepStrictEqual(
						rows.map((row) => row.sequence),
						Arr.range(1, 25)
					)
				})
			)
		})
	)
})

Vitest.layer(isolatedEngine())("one transaction per event", (it) => {
	it.effect("rolls back apply writes when the projector fails before checkpoint", () =>
		Effect.gen(function*() {
			const name = yield* decodeName("projection.alpha")
			const store = yield* OrchestrationEventStore
			const state = yield* ProjectionState
			yield* store.append(seedEvents(1))
			const projector = tableProjector(name, {
				afterWrite: () =>
					new ProjectionApplyError({
						name,
						detail: "fail after writing the projection row"
					})
			})
			yield* withPipeline(
				[projector],
				Effect.gen(function*() {
					yield* waitForHealth(name, "degraded")
					const rows = yield* readProjected(name)
					const checkpoint = yield* state.lastApplied(name)
					Vitest.assert.deepStrictEqual(rows, [])
					Vitest.assert.strictEqual(checkpoint, 0)
				})
			)
		})
	)
})

Vitest.layer(isolatedEngine())("projector failure isolation", (it) => {
	it.effect("marks the failed projector degraded and keeps the other running", () =>
		Effect.gen(function*() {
			const alpha = yield* decodeName("projection.alpha")
			const beta = yield* decodeName("projection.beta")
			const store = yield* OrchestrationEventStore
			yield* store.append(seedEvents(3))
			const failing = tableProjector(alpha, {
				beforeApply: () =>
					new ProjectionApplyError({
						name: alpha,
						detail: "boom"
					})
			})
			const healthy = tableProjector(beta)
			yield* withPipeline(
				[failing, healthy],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* waitForHealth(alpha, "degraded")
					yield* waitForSequence(beta, 3)
					const alphaHealth = yield* pipeline.health(alpha)
					const betaHealth = yield* pipeline.health(beta)
					const alphaRows = yield* readProjected(alpha)
					const betaRows = yield* readProjected(beta)
					Vitest.assert.strictEqual(alphaHealth, "degraded")
					Vitest.assert.strictEqual(betaHealth, "healthy")
					Vitest.assert.deepStrictEqual(alphaRows, [])
					Vitest.assert.deepStrictEqual(
						betaRows.map((row) => row.sequence),
						[1, 2, 3]
					)
				})
			)
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild", (it) => {
	it.effect("truncates projector tables, resets the checkpoint, and replays from 0", () =>
		Effect.gen(function*() {
			const name = yield* decodeName("projection.alpha")
			const store = yield* OrchestrationEventStore
			const state = yield* ProjectionState
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedEvents(3))
			yield* withPipeline(
				[tableProjector(name)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* waitForSequence(name, 3)
					yield* sql`
						INSERT INTO projection_pipeline_test (projector, sequence, event_id)
						VALUES (${name}, 999, 'bogus')
					`.withoutTransform
					yield* pipeline.rebuild(name)
					yield* waitForSequence(name, 3)
					const rows = yield* readProjected(name)
					const checkpoint = yield* state.lastApplied(name)
					const health = yield* pipeline.health(name)
					Vitest.assert.strictEqual(health, "healthy")
					Vitest.assert.strictEqual(checkpoint, 3)
					Vitest.assert.deepStrictEqual(
						rows.map((row) => row.sequence),
						[1, 2, 3]
					)
					Vitest.assert.deepStrictEqual(
						rows.map((row) => row.event_id),
						["event-1", "event-2", "event-3"]
					)
				})
			)
		})
	)

	it.effect("fails rebuild for an unknown projector name", () =>
		Effect.gen(function*() {
			const name = yield* decodeName("projection.alpha")
			yield* withPipeline(
				[tableProjector(name)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					const error = yield* Effect.flip(pipeline.rebuild("projection.missing"))
					Vitest.assert.strictEqual(error._tag, "ProjectionUnknownError")
					Vitest.assert.isTrue(Schema.is(ProjectionUnknownError)(error))
				})
			)
		})
	)
})

Vitest.layer(isolatedEngine())("kill mid-catch-up", (it) => {
	it.effect("restarts to the same tables as an uninterrupted run", () =>
		Effect.gen(function*() {
			const name = yield* decodeName("projection.alpha")
			const store = yield* OrchestrationEventStore
			const state = yield* ProjectionState
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedEvents(10))
			const expected = yield* withPipeline(
				[tableProjector(name)],
				Effect.gen(function*() {
					yield* waitForSequence(name, 10)
					return yield* readProjected(name)
				})
			)
			yield* sql`DELETE FROM projection_pipeline_test`.withoutTransform
			yield* state.checkpoint(name, 0)
			const reached = yield* Deferred.make<boolean>()
			const stall = tableProjector(name, {
				afterWrite: (event) =>
					Effect.gen(function*() {
						if (event.sequence !== 4) {
							return
						}
						yield* Deferred.succeed(reached, true)
						return yield* Effect.never
					})
			})
			yield* withPipeline([stall], Deferred.await(reached))
			const restarted = yield* withPipeline(
				[tableProjector(name)],
				Effect.gen(function*() {
					yield* waitForSequence(name, 10)
					return yield* readProjected(name)
				})
			)
			Vitest.assert.deepStrictEqual(restarted, expected)
			Vitest.assert.deepStrictEqual(
				expected.map((row) => row.sequence),
				[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
			)
		})
	)
})
