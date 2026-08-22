import {
	APP_VOICE_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	placeholderVoiceModel,
	ProjectId
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
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import { ProjectionVoice } from "../Services/ProjectionVoice.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionVoiceLive } from "./ProjectionVoice.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const voiceEvent = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "voice",
	aggregateId: APP_VOICE_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "VoiceModelsListed",
	payload: {
		models: [placeholderVoiceModel("external")]
	}
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
	voice_id: Schema.String,
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

const VoiceLive = ProjectionVoiceLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedVoice = () => Layer.fresh(VoiceLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionVoiceLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionVoice")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT voice_id, sequence
		FROM projection_voice
		ORDER BY voice_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (voice: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: voice.name,
	apply: voice.apply,
	truncate: voice.truncate
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
		aggregateKind: "voice",
		aggregateId: APP_VOICE_ID,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "VoiceModelsListed",
		payload: {
			models: [placeholderVoiceModel("external")]
		}
	}
]

Vitest.layer(isolatedVoice())("one voice row", (it) => {
	it.effect("upserts the listed models and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const voice = yield* ProjectionVoice
			yield* voice.apply(projectCreated, sql)
			yield* voice.apply(voiceEvent(2), sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [{ voice_id: "app", sequence: 2 }])
			const projected = yield* voice.get()
			Vitest.assert.deepStrictEqual(
				projected,
				Option.some({
					sequence: 2,
					models: [placeholderVoiceModel("external")],
					languages: [],
					recording: null,
					lastTranscription: null
				})
			)
		})
	)
})

Vitest.layer(isolatedVoice())("truncate", (it) => {
	it.effect("clears the projection_voice row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const voice = yield* ProjectionVoice
			yield* voice.apply(voiceEvent(1), sql)
			yield* voice.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.voice", (it) => {
	it.effect("replays voice events into one catalog row", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const voice = yield* ProjectionVoice
			yield* store.append(seedLog())
			yield* withPipeline([projectorOf(voice)], waitForSequence(voice.name, 1))
			const projected = yield* voice.get()
			Vitest.assert.deepStrictEqual(
				projected,
				Option.some({
					sequence: 1,
					models: [placeholderVoiceModel("external")],
					languages: [],
					recording: null,
					lastTranscription: null
				})
			)
		})
	)
})
