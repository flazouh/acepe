import {
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	TurnId
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
import { ProjectionState } from "../Services/ProjectionState.ts"
import { ProjectionTurns } from "../Services/ProjectionTurns.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { ProjectionTurnsLive } from "./ProjectionTurns.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const END = "2026-08-20T12:00:02.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const sessionTwoId = SessionId.make("session-2")
const messageId = MessageId.make("message-1")
const secondMessageId = MessageId.make("message-2")
const assistantMessageId = MessageId.make("message-1:assistant")
const turnId = TurnId.make("message-1")
const secondTurnId = TurnId.make("message-2")

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	"SessionCreated" | "MessageSent" | "TokenAppended" | "TurnCancelled"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
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

const projectCreatedEvent = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
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
})

const DumpRow = Schema.Struct({
	turn_id: Schema.String,
	session_id: Schema.String,
	sequence: Schema.Number,
	status: Schema.String,
	started_at: Schema.NullOr(Schema.String),
	ended_at: Schema.NullOr(Schema.String),
	cancelled_at: Schema.NullOr(Schema.String),
	input_tokens: Schema.Number,
	output_tokens: Schema.Number,
	cache_read_tokens: Schema.Number,
	cache_write_tokens: Schema.Number,
	cost_usd: Schema.Number
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

const TurnsLive = ProjectionTurnsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedTurns = () => Layer.fresh(TurnsLive)

const SnapshotLive = Layer.mergeAll(ProjectionTurnsLive, ProjectionSnapshotQueryLive).pipe(
	Layer.provideMerge(MigratedSqlite)
)

const isolatedSnapshot = () => Layer.fresh(SnapshotLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionTurnsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionTurns")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT
			turn_id,
			session_id,
			sequence,
			status,
			started_at,
			ended_at,
			cancelled_at,
			input_tokens,
			output_tokens,
			cache_read_tokens,
			cache_write_tokens,
			cost_usd
		FROM projection_turns
		ORDER BY session_id ASC, sequence ASC, turn_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (turns: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: turns.name,
	apply: turns.apply,
	truncate: turns.truncate
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

const checkpoint = Effect.fn("checkpoint")(function*(name: string, sequence: number) {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_state (name, last_applied_sequence)
		VALUES (${name}, ${sequence})
		ON CONFLICT(name) DO UPDATE SET
			last_applied_sequence = excluded.last_applied_sequence
	`.withoutTransform.pipe(Effect.asVoid)
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
	{
		eventId: EventId.make("event-2"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionCreated",
		payload: {
			sessionId,
			projectId,
			title: "First session"
		}
	},
	{
		eventId: EventId.make("event-3"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: NOW,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "MessageSent",
		payload: {
			sessionId,
			messageId,
			text: "Ship the slice"
		}
	},
	{
		eventId: EventId.make("event-4"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "TokenAppended",
		payload: {
			sessionId,
			messageId: assistantMessageId,
			token: "Hello"
		}
	},
	{
		eventId: EventId.make("event-5"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "TokenAppended",
		payload: {
			sessionId,
			messageId: assistantMessageId,
			token: " from"
		}
	},
	{
		eventId: EventId.make("event-6"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionCreated",
		payload: {
			sessionId: sessionTwoId,
			projectId,
			title: "Interrupted session"
		}
	},
	{
		eventId: EventId.make("event-7"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: END,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "MessageSent",
		payload: {
			sessionId: sessionTwoId,
			messageId: secondMessageId,
			text: "Still streaming"
		}
	},
	{
		eventId: EventId.make("event-8"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: END,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "TurnCancelled",
		payload: {
			sessionId,
			turnId
		}
	}
]

Vitest.layer(isolatedTurns())("one row per turn", (it) => {
	it.effect("inserts a turn row and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const turns = yield* ProjectionTurns
			yield* turns.apply(projectCreatedEvent(1), sql)
			yield* turns.apply(
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sql
			)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(
				rows.map((row) => row.turn_id),
				["message-1"]
			)
			Vitest.assert.strictEqual(rows[0]?.status, "running")
			Vitest.assert.strictEqual(rows[0]?.session_id, "session-1")
		})
	)
})

Vitest.layer(isolatedTurns())("turn lifecycle from events", (it) => {
	it.effect("cancels the open turn and keeps an interrupted turn running", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const turns = yield* ProjectionTurns
			yield* turns.apply(
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(3, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(4, "TurnCancelled", END, {
					sessionId,
					turnId
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(
					5,
					"MessageSent",
					END,
					{
						sessionId: sessionTwoId,
						messageId: secondMessageId,
						text: "Still streaming"
					},
					sessionTwoId
				),
				sql
			)
			const cancelled = yield* turns.get(turnId)
			const interrupted = yield* turns.get(secondTurnId)
			Vitest.assert.strictEqual(
				Option.match(cancelled, {
					onNone: () => "",
					onSome: (turn) => turn.status
				}),
				"cancelled"
			)
			Vitest.assert.strictEqual(
				Option.match(interrupted, {
					onNone: () => "",
					onSome: (turn) => turn.status
				}),
				"running"
			)
			Vitest.assert.strictEqual(
				Option.match(interrupted, {
					onNone: () => "missing",
					onSome: (turn) => (turn.endedAt === null ? "open" : "closed")
				}),
				"open"
			)
		})
	)
})

Vitest.layer(isolatedTurns())("session usage totals", (it) => {
	it.effect("sums usage and cost from projection_turns, with no separate counter table", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const turns = yield* ProjectionTurns
			yield* turns.apply(
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "First"
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(3, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(4, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: " from"
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(5, "MessageSent", END, {
					sessionId,
					messageId: secondMessageId,
					text: "Second"
				}),
				sql
			)
			const totals = yield* turns.sessionTotals(sessionId)
			Vitest.assert.deepStrictEqual(totals, {
				sessionId,
				inputTokens: 0,
				outputTokens: 2,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costUsd: 0
			})
			const counterTables = yield* sql<{ name: string }>`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
					AND name = 'projection_session_usage'
			`.withoutTransform
			Vitest.assert.deepStrictEqual(counterTables, [])
		})
	)
})

Vitest.layer(isolatedTurns())("truncate", (it) => {
	it.effect("clears every projection_turns row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const turns = yield* ProjectionTurns
			yield* turns.apply(
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sql
			)
			yield* turns.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.turns", (it) => {
	it.effect("reproduces the table identically from the same event log", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const turns = yield* ProjectionTurns
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedLog())
			const original = yield* withPipeline(
				[projectorOf(turns)],
				Effect.gen(function*() {
					yield* waitForSequence(turns.name, 8)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(
				original.map((row) => ({
					turn_id: row.turn_id,
					session_id: row.session_id,
					status: row.status,
					output_tokens: row.output_tokens,
					ended_at: row.ended_at
				})),
				[
					{
						turn_id: "message-1",
						session_id: "session-1",
						status: "cancelled",
						output_tokens: 2,
						ended_at: END
					},
					{
						turn_id: "message-2",
						session_id: "session-2",
						status: "running",
						output_tokens: 0,
						ended_at: null
					}
				]
			)
			yield* sql`
				UPDATE projection_turns
				SET status = 'completed',
					output_tokens = 99
				WHERE turn_id = ${turnId}
			`.withoutTransform
			const rebuilt = yield* withPipeline(
				[projectorOf(turns)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* pipeline.rebuild(turns.name)
					yield* waitForSequence(turns.name, 8)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(rebuilt, original)
		})
	)
})

Vitest.layer(isolatedSnapshot())("ProjectionSnapshotQuery grades turns", (it) => {
	it.effect("returns the projected turns for the session", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const turns = yield* ProjectionTurns
			const query = yield* ProjectionSnapshotQuery
			yield* turns.apply(
				sessionEvent(3, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ping"
				}),
				sql
			)
			yield* turns.apply(
				sessionEvent(4, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				}),
				sql
			)
			yield* checkpoint("projection.sessions", 4)
			yield* checkpoint("projection.session-messages", 4)
			yield* checkpoint("projection.turns", 4)
			yield* checkpoint("projection.session-activities", 4)
			yield* checkpoint("projection.pending-approvals", 4)
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.deepStrictEqual(snapshot.turns, [
				{
					turnId,
					sessionId,
					sequence: 3
				}
			])
		})
	)
})
