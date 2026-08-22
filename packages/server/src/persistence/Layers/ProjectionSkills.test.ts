import {
	APP_SKILLS_ID,
	CommandId,
	emptySkillsCatalog,
	EventId,
	type OrchestrationEvent,
	ProjectId,
	skillsSnapshotRequest,
	SkillsDiscoverCommand
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { makeAcepeLive } from "../../bootstrap.ts"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import { ProjectionSkills } from "../Services/ProjectionSkills.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionSkillsLive } from "./ProjectionSkills.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const skillsEvent = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "skills",
	aggregateId: APP_SKILLS_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SkillsDiscovered",
	payload: emptySkillsCatalog
})

const projectCreated: OrchestrationEvent = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

const DumpRow = Schema.Struct({
	catalog_id: Schema.String,
	sequence: Schema.Number
})
const decodeDumpRows = Schema.decodeUnknownEffect(Schema.Array(DumpRow))

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

const SkillsLive = ProjectionSkillsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedSkills = () => Layer.fresh(SkillsLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionSkillsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionSkills")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT catalog_id, sequence
		FROM projection_skills_catalog
		ORDER BY catalog_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (skills: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: skills.name,
	apply: skills.apply,
	truncate: skills.truncate
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

const seedLog = (): ReadonlyArray<NewOrchestrationEvent> => [
	{
		eventId: EventId.make("event-1"),
		aggregateKind: "skills",
		aggregateId: APP_SKILLS_ID,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SkillsDiscovered",
		payload: emptySkillsCatalog
	}
]

Vitest.layer(isolatedSkills())("one catalog row", (it) => {
	it.effect("upserts the discovered catalog and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const skills = yield* ProjectionSkills
			yield* skills.apply(projectCreated, sql)
			yield* skills.apply(skillsEvent(2), sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [{ catalog_id: "app", sequence: 2 }])
			const catalog = yield* skills.get()
			Vitest.assert.deepStrictEqual(
				catalog,
				Option.some({
					sequence: 2,
					agents: [],
					agentSkills: [],
					plugins: [],
					pluginSkills: [],
					tree: []
				})
			)
		})
	)
})

Vitest.layer(isolatedSkills())("truncate", (it) => {
	it.effect("clears the projection_skills_catalog row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const skills = yield* ProjectionSkills
			yield* skills.apply(skillsEvent(1), sql)
			yield* skills.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.skills", (it) => {
	it.effect("replays skills events into one catalog row", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const skills = yield* ProjectionSkills
			yield* store.append(seedLog())
			yield* withPipeline([projectorOf(skills)], waitForSequence(skills.name, 1))
			const catalog = yield* skills.get()
			Vitest.assert.deepStrictEqual(
				catalog,
				Option.some({
					sequence: 1,
					agents: [],
					agentSkills: [],
					plugins: [],
					pluginSkills: [],
					tree: []
				})
			)
		})
	)
})

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const waitForSkillsCatalog = Effect.fn("waitForSkillsCatalog")(function*() {
	const snapshots = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* snapshots.forRequest(skillsSnapshotRequest())
		if (snapshot.skillsCatalog !== null) {
			return snapshot
		}
		yield* Effect.sleep(Duration.millis(10))
	}
	return yield* snapshots.forRequest(skillsSnapshotRequest())
})

Vitest.it.live("survives a process restart through dispatch and snapshot", () =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectory()
		const filename = path.join(dir, "acepe-skills.db")
		const discover = SkillsDiscoverCommand.make({
			type: "skills.discover",
			commandId: CommandId.make("cmd-skills-discover"),
			catalog: emptySkillsCatalog
		})
		yield* Effect.scoped(
			Effect.gen(function*() {
				const engine = yield* OrchestrationEngine
				yield* engine.dispatch(discover)
				const snapshot = yield* waitForSkillsCatalog()
				Vitest.assert.isNotNull(snapshot.skillsCatalog)
				if (snapshot.skillsCatalog !== null) {
					Vitest.assert.strictEqual(snapshot.skillsCatalog.sequence, 1)
					Vitest.assert.deepStrictEqual(snapshot.skillsCatalog.tree, [])
				}
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(
					makeAcepeLive({
						filename,
						tokenDelay: Duration.zero
					}).pipe(Layer.fresh)
				)
			)
		)
		yield* Effect.scoped(
			Effect.gen(function*() {
				const snapshot = yield* waitForSkillsCatalog()
				Vitest.assert.isNotNull(snapshot.skillsCatalog)
				if (snapshot.skillsCatalog !== null) {
					Vitest.assert.strictEqual(snapshot.skillsCatalog.sequence, 1)
				}
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(
					makeAcepeLive({
						filename,
						tokenDelay: Duration.zero
					}).pipe(Layer.fresh)
				)
			)
		)
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(Platform)
	),
	20_000
)
