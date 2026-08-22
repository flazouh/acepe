import {
	APP_SETTINGS_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectId,
	SettingsSetCommand,
	settingsSnapshotRequest
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
import { ProjectionSettings } from "../Services/ProjectionSettings.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionSettingsLive } from "./ProjectionSettings.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")

const settingsEvent = (
	sequence: number,
	key: "ui_font_size" | "code_font_size" | "user_theme",
	value: string
): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "settings",
	aggregateId: APP_SETTINGS_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SettingsUpdated",
	payload: {
		key,
		value
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
	setting_key: Schema.String,
	setting_value: Schema.String,
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

const SettingsLive = ProjectionSettingsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedSettings = () => Layer.fresh(SettingsLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionSettingsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionSettings")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT setting_key, setting_value, sequence
		FROM projection_settings
		ORDER BY setting_key ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (settings: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: settings.name,
	apply: settings.apply,
	truncate: settings.truncate
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
		aggregateKind: "settings",
		aggregateId: APP_SETTINGS_ID,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SettingsUpdated",
		payload: {
			key: "ui_font_size",
			value: "14"
		}
	},
	{
		eventId: EventId.make("event-2"),
		aggregateKind: "settings",
		aggregateId: APP_SETTINGS_ID,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SettingsUpdated",
		payload: {
			key: "code_font_size",
			value: "13"
		}
	},
	{
		eventId: EventId.make("event-3"),
		aggregateKind: "settings",
		aggregateId: APP_SETTINGS_ID,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SettingsUpdated",
		payload: {
			key: "ui_font_size",
			value: "16"
		}
	}
]

Vitest.layer(isolatedSettings())("one row per setting key", (it) => {
	it.effect("upserts settings and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const settings = yield* ProjectionSettings
			yield* settings.apply(projectCreated, sql)
			yield* settings.apply(settingsEvent(2, "ui_font_size", "14"), sql)
			yield* settings.apply(settingsEvent(3, "code_font_size", "13"), sql)
			yield* settings.apply(settingsEvent(4, "ui_font_size", "16"), sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [
				{ setting_key: "code_font_size", setting_value: "13", sequence: 3 },
				{ setting_key: "ui_font_size", setting_value: "16", sequence: 4 }
			])
			const listed = yield* settings.list()
			Vitest.assert.strictEqual(listed.length, 2)
			const ui = yield* settings.get("ui_font_size")
			Vitest.assert.deepStrictEqual(
				ui,
				Option.some({
					key: "ui_font_size",
					value: "16",
					sequence: 4
				})
			)
		})
	)
})

Vitest.layer(isolatedSettings())("truncate", (it) => {
	it.effect("clears every projection_settings row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const settings = yield* ProjectionSettings
			yield* settings.apply(settingsEvent(1, "user_theme", "dark"), sql)
			yield* settings.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.settings", (it) => {
	it.effect("replays settings events into one row per key", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const settings = yield* ProjectionSettings
			yield* store.append(seedLog())
			yield* withPipeline([projectorOf(settings)], waitForSequence(settings.name, 3))
			const listed = yield* settings.list()
			Vitest.assert.deepStrictEqual(listed, [
				{ key: "code_font_size", value: "13", sequence: 2 },
				{ key: "ui_font_size", value: "16", sequence: 3 }
			])
		})
	)
})

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const waitForUiFontSize = Effect.fn("waitForUiFontSize")(function*(value: string) {
	const snapshots = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const snapshot = yield* snapshots.forRequest(settingsSnapshotRequest())
		const setting = Arr.findFirst(snapshot.settings, (row) => row.key === "ui_font_size")
		if (Option.isSome(setting) && setting.value.value === value) {
			return snapshot
		}
		yield* Effect.sleep(Duration.millis(10))
	}
	return yield* snapshots.forRequest(settingsSnapshotRequest())
})

Vitest.it.live("survives a process restart through dispatch and snapshot", () =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectory()
		const filename = path.join(dir, "acepe-settings.db")
		const setFont = SettingsSetCommand.make({
			type: "settings.set",
			commandId: CommandId.make("cmd-settings-font"),
			key: "ui_font_size",
			value: "18"
		})
		yield* Effect.scoped(
			Effect.gen(function*() {
				const engine = yield* OrchestrationEngine
				yield* engine.dispatch(setFont)
				const snapshot = yield* waitForUiFontSize("18")
				const setting = Arr.findFirst(snapshot.settings, (row) => row.key === "ui_font_size")
				Vitest.assert.isTrue(Option.isSome(setting))
				if (Option.isSome(setting)) {
					Vitest.assert.strictEqual(setting.value.value, "18")
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
				const snapshot = yield* waitForUiFontSize("18")
				const setting = Arr.findFirst(snapshot.settings, (row) => row.key === "ui_font_size")
				Vitest.assert.isTrue(Option.isSome(setting))
				if (Option.isSome(setting)) {
					Vitest.assert.strictEqual(setting.value.value, "18")
					Vitest.assert.strictEqual(setting.value.key, "ui_font_size")
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
