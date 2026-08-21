import {
	CheckpointId,
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	ToolCallId
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
import { ProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts"
import { runMigrations } from "../Migrations.ts"
import { type NewOrchestrationEvent, OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import { ProjectionCheckpoints } from "../Services/ProjectionCheckpoints.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionCheckpointsLive } from "./ProjectionCheckpoints.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const checkpointReadyId = CheckpointId.make("checkpoint-ready")
const checkpointMissingId = CheckpointId.make("checkpoint-missing")
const checkpointErrorId = CheckpointId.make("checkpoint-error")
const toolCallId = ToolCallId.make("tool-1")

type CheckpointEventType = Extract<
	OrchestrationEvent["type"],
	"CheckpointCreated" | "CheckpointReadinessChanged" | "CheckpointReverted"
>

const sessionEvent = <const Type extends CheckpointEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	aggregateId: SessionId = sessionId
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const DumpRow = Schema.Struct({
	checkpoint_id: Schema.String,
	session_id: Schema.String,
	sequence: Schema.Number,
	checkpoint_number: Schema.Number,
	name: Schema.NullOr(Schema.String),
	is_auto: Schema.Number,
	tool_call_id: Schema.NullOr(Schema.String),
	file_count: Schema.Number,
	status: Schema.String,
	created_at: Schema.String,
	last_reverted_at: Schema.NullOr(Schema.String)
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

const CheckpointsLive = ProjectionCheckpointsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedCheckpoints = () => Layer.fresh(CheckpointsLive)

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

const SnapshotLive = ProjectionSnapshotQueryLive.pipe(Layer.provideMerge(EngineLive))

const isolatedEngine = () => Layer.fresh(EngineLive)

const isolatedSnapshot = () => Layer.fresh(SnapshotLive)

const dumpTable = Effect.fn("dumpProjectionCheckpoints")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT
			checkpoint_id,
			session_id,
			sequence,
			checkpoint_number,
			name,
			is_auto,
			tool_call_id,
			file_count,
			status,
			created_at,
			last_reverted_at
		FROM projection_checkpoints
		ORDER BY session_id ASC, checkpoint_number ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

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

const created = (
	sequence: number,
	checkpointId: CheckpointId,
	checkpointNumber: number,
	isAuto: boolean
): NewOrchestrationEvent => ({
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "CheckpointCreated",
	payload: {
		sessionId,
		checkpointId,
		checkpointNumber,
		name: checkpointId,
		isAuto,
		toolCallId: isAuto ? toolCallId : null,
		fileCount: checkpointNumber
	}
})

const seedLog = (): ReadonlyArray<NewOrchestrationEvent> => [
	{
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
	},
	created(2, checkpointReadyId, 1, true),
	created(3, checkpointMissingId, 2, false),
	created(4, checkpointErrorId, 3, true),
	{
		eventId: EventId.make("event-5"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "CheckpointReadinessChanged",
		payload: {
			sessionId,
			checkpointId: checkpointReadyId,
			status: "ready" as const
		}
	},
	{
		eventId: EventId.make("event-6"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "CheckpointReadinessChanged",
		payload: {
			sessionId,
			checkpointId: checkpointErrorId,
			status: "error" as const
		}
	},
	{
		eventId: EventId.make("event-7"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "CheckpointReverted",
		payload: {
			sessionId,
			checkpointId: checkpointReadyId
		}
	}
]

const REFERENCE_CHECKPOINTS = [
	{
		checkpointId: checkpointReadyId,
		sessionId,
		sequence: 7,
		checkpointNumber: 1,
		name: checkpointReadyId,
		isAuto: true,
		toolCallId,
		fileCount: 1,
		status: "ready" as const,
		createdAt: NOW,
		lastRevertedAt: LATER
	},
	{
		checkpointId: checkpointMissingId,
		sessionId,
		sequence: 3,
		checkpointNumber: 2,
		name: checkpointMissingId,
		isAuto: false,
		toolCallId: null,
		fileCount: 2,
		status: "missing" as const,
		createdAt: NOW,
		lastRevertedAt: null
	},
	{
		checkpointId: checkpointErrorId,
		sessionId,
		sequence: 6,
		checkpointNumber: 3,
		name: checkpointErrorId,
		isAuto: true,
		toolCallId,
		fileCount: 3,
		status: "error" as const,
		createdAt: NOW,
		lastRevertedAt: null
	}
]

Vitest.layer(isolatedCheckpoints())("one row per checkpoint", (it) => {
	it.effect("inserts checkpoint rows and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const checkpoints = yield* ProjectionCheckpoints
			yield* checkpoints.apply(
				{
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
				},
				sql
			)
			yield* checkpoints.apply(
				sessionEvent(2, "CheckpointCreated", NOW, {
					sessionId,
					checkpointId: checkpointReadyId,
					checkpointNumber: 1,
					name: "Ready",
					isAuto: true,
					toolCallId,
					fileCount: 1
				}),
				sql
			)
			yield* checkpoints.apply(
				sessionEvent(
					3,
					"CheckpointCreated",
					NOW,
					{
						sessionId: otherSessionId,
						checkpointId: checkpointMissingId,
						checkpointNumber: 1,
						name: null,
						isAuto: false,
						toolCallId: null,
						fileCount: 0
					},
					otherSessionId
				),
				sql
			)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(
				rows.map((row) => row.checkpoint_id),
				["checkpoint-ready", "checkpoint-missing"]
			)
			Vitest.assert.strictEqual(rows[0]?.status, "missing")
			Vitest.assert.strictEqual(rows[1]?.status, "missing")
		})
	)
})

Vitest.layer(isolatedCheckpoints())("readiness and revert", (it) => {
	it.effect("stores derived status and last_reverted_at", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const checkpoints = yield* ProjectionCheckpoints
			yield* checkpoints.apply(
				sessionEvent(1, "CheckpointCreated", NOW, {
					sessionId,
					checkpointId: checkpointReadyId,
					checkpointNumber: 1,
					name: "Ready",
					isAuto: true,
					toolCallId,
					fileCount: 1
				}),
				sql
			)
			yield* checkpoints.apply(
				sessionEvent(2, "CheckpointReadinessChanged", LATER, {
					sessionId,
					checkpointId: checkpointReadyId,
					status: "ready" as const
				}),
				sql
			)
			yield* checkpoints.apply(
				sessionEvent(3, "CheckpointReverted", LATER, {
					sessionId,
					checkpointId: checkpointReadyId
				}),
				sql
			)
			const row = yield* checkpoints.get(checkpointReadyId)
			const checkpoint = Option.match(row, {
				onNone: () => {
					Vitest.assert.fail("expected a projected checkpoint")
					return undefined as never
				},
				onSome: (value) => value
			})
			Vitest.assert.strictEqual(checkpoint.status, "ready")
			Vitest.assert.strictEqual(checkpoint.lastRevertedAt, LATER)
			const listed = yield* checkpoints.listBySession(sessionId)
			Vitest.assert.strictEqual(listed.length, 1)
			Vitest.assert.strictEqual(listed[0]?.lastRevertedAt, LATER)
		})
	)
})

Vitest.layer(isolatedCheckpoints())("truncate", (it) => {
	it.effect("clears every projection_checkpoints row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const checkpoints = yield* ProjectionCheckpoints
			yield* checkpoints.apply(
				sessionEvent(1, "CheckpointCreated", NOW, {
					sessionId,
					checkpointId: checkpointReadyId,
					checkpointNumber: 1,
					name: "Ready",
					isAuto: true,
					toolCallId,
					fileCount: 1
				}),
				sql
			)
			yield* checkpoints.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.checkpoints", (it) => {
	it.effect("reproduces the table identically from the same event log", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const checkpoints = yield* ProjectionCheckpoints
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedLog())
			const original = yield* withPipeline(
				[projectorOf(checkpoints)],
				Effect.gen(function*() {
					yield* waitForSequence(checkpoints.name, 7)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(
				original.map((row) => ({
					checkpoint_id: row.checkpoint_id,
					status: row.status,
					last_reverted_at: row.last_reverted_at
				})),
				[
					{
						checkpoint_id: "checkpoint-ready",
						status: "ready" as const,
						last_reverted_at: LATER
					},
					{
						checkpoint_id: "checkpoint-missing",
						status: "missing" as const,
						last_reverted_at: null
					},
					{
						checkpoint_id: "checkpoint-error",
						status: "error" as const,
						last_reverted_at: null
					}
				]
			)
			yield* sql`
				UPDATE projection_checkpoints
				SET status = 'error'
				WHERE checkpoint_id = ${checkpointReadyId}
			`.withoutTransform
			const rebuilt = yield* withPipeline(
				[projectorOf(checkpoints)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* pipeline.rebuild(checkpoints.name)
					yield* waitForSequence(checkpoints.name, 7)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(rebuilt, original)
		})
	)
})

Vitest.layer(isolatedSnapshot())("grade through ProjectionSnapshotQuery", (it) => {
	it.effect("matches the reference checkpoint fixture", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const checkpoints = yield* ProjectionCheckpoints
			yield* store.append(seedLog())
			yield* withPipeline([projectorOf(checkpoints)], waitForSequence(checkpoints.name, 7))
			const query = yield* ProjectionSnapshotQuery
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.deepStrictEqual(snapshot.checkpoints, REFERENCE_CHECKPOINTS)
		})
	)
})
