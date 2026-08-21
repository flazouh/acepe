import {
	ApprovalRequestId,
	CommandId,
	EventId,
	type JsonObject,
	type OrchestrationEvent,
	ProjectId,
	SessionId
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
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import { ProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts"
import projectionPendingApprovalsMigration from "../Migrations/0010_projection_pending_approvals.ts"
import { runMigrations } from "../Migrations.ts"
import { OrchestrationCommandReceipts } from "../Services/OrchestrationCommandReceipts.ts"
import {
	type NewOrchestrationEvent,
	OrchestrationEventStore
} from "../Services/OrchestrationEventStore.ts"
import {
	type ApprovalAnsweredFact,
	type ApprovalRequestedFact,
	pendingApprovalMetadata,
	ProjectionPendingApprovals
} from "../Services/ProjectionPendingApprovals.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationCommandReceiptsLive } from "./OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts"
import { ProjectionPendingApprovalsLive } from "./ProjectionPendingApprovals.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const END = "2026-08-20T12:00:02.000Z"
const commandId = CommandId.make("cmd-1")
const answerCommandId = CommandId.make("cmd-answer-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const sessionTwoId = SessionId.make("session-2")
const approvalRequestId = ApprovalRequestId.make("approval-1")
const secondApprovalRequestId = ApprovalRequestId.make("approval-2")
const thirdApprovalRequestId = ApprovalRequestId.make("approval-3")

const requestedFact = (
	id: ApprovalRequestId,
	targetSessionId: SessionId
): ApprovalRequestedFact => ({
	type: "ApprovalRequested",
	approvalRequestId: id,
	sessionId: targetSessionId
})

const answeredFact = (
	id: ApprovalRequestId,
	targetSessionId: SessionId
): ApprovalAnsweredFact => ({
	type: "ApprovalAnswered",
	approvalRequestId: id,
	sessionId: targetSessionId,
	decision: "allow"
})

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	"SessionCreated" | "SessionMetaUpdated"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	options: {
		readonly aggregateId?: SessionId
		readonly commandId?: CommandId
		readonly metadata?: JsonObject
	} = {}
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: options.aggregateId ?? sessionId,
	occurredAt,
	commandId: options.commandId ?? commandId,
	causationEventId: null,
	correlationId: options.commandId ?? commandId,
	metadata: options.metadata ?? {},
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

const sessionCreatedEvent = (
	sequence: number,
	targetSessionId: SessionId = sessionId
): OrchestrationEvent =>
	sessionEvent(
		sequence,
		"SessionCreated",
		NOW,
		{
			sessionId: targetSessionId,
			projectId,
			title: "First session"
		},
		{ aggregateId: targetSessionId }
	)

const requestEvent = (
	sequence: number,
	id: ApprovalRequestId = approvalRequestId,
	targetSessionId: SessionId = sessionId
): OrchestrationEvent =>
	sessionEvent(
		sequence,
		"SessionMetaUpdated",
		LATER,
		{ sessionId: targetSessionId },
		{
			aggregateId: targetSessionId,
			metadata: pendingApprovalMetadata(requestedFact(id, targetSessionId))
		}
	)

const answerEvent = (
	sequence: number,
	id: ApprovalRequestId = approvalRequestId,
	targetSessionId: SessionId = sessionId
): OrchestrationEvent =>
	sessionEvent(
		sequence,
		"SessionMetaUpdated",
		END,
		{ sessionId: targetSessionId },
		{
			aggregateId: targetSessionId,
			commandId: answerCommandId,
			metadata: pendingApprovalMetadata(answeredFact(id, targetSessionId))
		}
	)

const DumpRow = Schema.Struct({
	approval_request_id: Schema.String,
	session_id: Schema.String,
	sequence: Schema.Number
})
const decodeDumpRows = Schema.decodeUnknownEffect(Schema.Array(DumpRow))

const applyPendingApprovalsMigration = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql<{ name: string }>`
		SELECT name
		FROM sqlite_master
		WHERE type = 'table'
			AND name = 'projection_pending_approvals'
	`.withoutTransform
	if (Option.isSome(Arr.head(rows))) {
		return
	}
	yield* projectionPendingApprovalsMigration
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

const MigratedSqlite = Layer.effectDiscard(
	Effect.gen(function*() {
		yield* runMigrations
		yield* applyPendingApprovalsMigration
	})
).pipe(Layer.provideMerge(TempSqlite))

const ApprovalsLive = ProjectionPendingApprovalsLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedApprovals = () => Layer.fresh(ApprovalsLive)

const SnapshotLive = Layer.mergeAll(ProjectionPendingApprovalsLive, ProjectionSnapshotQueryLive).pipe(
	Layer.provideMerge(MigratedSqlite)
)

const isolatedSnapshot = () => Layer.fresh(SnapshotLive)

const ReceiptsLive = Layer.mergeAll(
	OrchestrationCommandReceiptsLive,
	ProjectionPendingApprovalsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const isolatedReceipts = () => Layer.fresh(ReceiptsLive)

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionPendingApprovalsLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

const dumpTable = Effect.fn("dumpProjectionPendingApprovals")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT
			approval_request_id,
			session_id,
			sequence
		FROM projection_pending_approvals
		ORDER BY session_id ASC, sequence ASC, approval_request_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (approvals: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectorDefinition["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: approvals.name,
	apply: approvals.apply,
	truncate: approvals.truncate
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
		occurredAt: LATER,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: pendingApprovalMetadata(requestedFact(approvalRequestId, sessionId)),
		type: "SessionMetaUpdated",
		payload: {
			sessionId
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
		metadata: pendingApprovalMetadata(requestedFact(secondApprovalRequestId, sessionId)),
		type: "SessionMetaUpdated",
		payload: {
			sessionId
		}
	},
	{
		eventId: EventId.make("event-5"),
		aggregateKind: "session",
		aggregateId: sessionId,
		occurredAt: END,
		commandId: answerCommandId,
		causationEventId: null,
		correlationId: answerCommandId,
		metadata: pendingApprovalMetadata(answeredFact(approvalRequestId, sessionId)),
		type: "SessionMetaUpdated",
		payload: {
			sessionId
		}
	},
	{
		eventId: EventId.make("event-6"),
		aggregateKind: "session",
		aggregateId: sessionTwoId,
		occurredAt: END,
		commandId,
		causationEventId: null,
		correlationId: commandId,
		metadata: {},
		type: "SessionCreated",
		payload: {
			sessionId: sessionTwoId,
			projectId,
			title: "Second session"
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
		metadata: pendingApprovalMetadata(requestedFact(thirdApprovalRequestId, sessionTwoId)),
		type: "SessionMetaUpdated",
		payload: {
			sessionId: sessionTwoId
		}
	}
]

const statusOf = (row: Option.Option<{ readonly approvalRequestId: ApprovalRequestId }>) =>
	Option.match(row, {
		onNone: () => "missing",
		onSome: () => "outstanding"
	})

Vitest.layer(isolatedApprovals())("one row per outstanding approval", (it) => {
	it.effect("inserts an approval row and ignores project events", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const approvals = yield* ProjectionPendingApprovals
			yield* approvals.apply(projectCreatedEvent(1), sql)
			yield* approvals.apply(sessionCreatedEvent(2), sql)
			yield* approvals.apply(requestEvent(3), sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(
				rows.map((row) => row.approval_request_id),
				["approval-1"]
			)
			Vitest.assert.strictEqual(rows[0]?.session_id, "session-1")
			Vitest.assert.strictEqual(Number(rows[0]?.sequence), 3)
		})
	)
})

Vitest.layer(isolatedApprovals())("answer removes the outstanding row", (it) => {
	it.effect("drops the answered approval and keeps the other session outstanding", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const approvals = yield* ProjectionPendingApprovals
			yield* approvals.apply(requestEvent(3), sql)
			yield* approvals.apply(requestEvent(4, secondApprovalRequestId, sessionTwoId), sql)
			yield* approvals.apply(answerEvent(5), sql)
			Vitest.assert.strictEqual(statusOf(yield* approvals.get(approvalRequestId)), "missing")
			Vitest.assert.strictEqual(
				statusOf(yield* approvals.get(secondApprovalRequestId)),
				"outstanding"
			)
		})
	)
})

Vitest.layer(isolatedApprovals())("truncate", (it) => {
	it.effect("clears every projection_pending_approvals row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const approvals = yield* ProjectionPendingApprovals
			yield* approvals.apply(requestEvent(3), sql)
			yield* approvals.truncate(sql)
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedReceipts())("answer twice via command receipt", (it) => {
	it.effect("returns the first sequence and does not recreate the row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const approvals = yield* ProjectionPendingApprovals
			const receipts = yield* OrchestrationCommandReceipts
			yield* approvals.apply(requestEvent(3), sql)
			const answerOnce = Effect.fn("answerOnce")(function*(event: OrchestrationEvent) {
				const replayed = yield* receipts.replay(event.commandId)
				if (Option.isSome(replayed)) {
					return replayed.value
				}
				yield* approvals.apply(event, sql)
				yield* receipts.record({
					commandId: event.commandId,
					status: "accepted",
					sequence: event.sequence
				})
				return event.sequence
			})
			const event = answerEvent(4)
			const first = yield* answerOnce(event)
			const second = yield* answerOnce(event)
			Vitest.assert.strictEqual(first, 4)
			Vitest.assert.strictEqual(second, 4)
			Vitest.assert.strictEqual(statusOf(yield* approvals.get(approvalRequestId)), "missing")
			const rows = yield* dumpTable()
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.pending-approvals", (it) => {
	it.effect("reproduces the table identically from the same event log", () =>
		Effect.gen(function*() {
			const store = yield* OrchestrationEventStore
			const approvals = yield* ProjectionPendingApprovals
			const sql = yield* SqlClient.SqlClient
			yield* store.append(seedLog())
			const original = yield* withPipeline(
				[projectorOf(approvals)],
				Effect.gen(function*() {
					yield* waitForSequence(approvals.name, 7)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(original, [
				{
					approval_request_id: "approval-2",
					session_id: "session-1",
					sequence: 4
				},
				{
					approval_request_id: "approval-3",
					session_id: "session-2",
					sequence: 7
				}
			])
			yield* sql`
				UPDATE projection_pending_approvals
				SET sequence = 99
				WHERE approval_request_id = ${secondApprovalRequestId}
			`.withoutTransform
			const rebuilt = yield* withPipeline(
				[projectorOf(approvals)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* pipeline.rebuild(approvals.name)
					yield* waitForSequence(approvals.name, 7)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(rebuilt, original)
		})
	)
})

Vitest.layer(isolatedSnapshot())("ProjectionSnapshotQuery grades pending approvals", (it) => {
	it.effect("returns the outstanding approvals for the session", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const approvals = yield* ProjectionPendingApprovals
			const query = yield* ProjectionSnapshotQuery
			yield* approvals.apply(requestEvent(3), sql)
			yield* approvals.apply(requestEvent(4, secondApprovalRequestId), sql)
			yield* approvals.apply(answerEvent(5), sql)
			yield* checkpoint("projection.sessions", 5)
			yield* checkpoint("projection.session-messages", 5)
			yield* checkpoint("projection.turns", 5)
			yield* checkpoint("projection.session-activities", 5)
			yield* checkpoint("projection.pending-approvals", 5)
			const snapshot = yield* query.snapshot(sessionId)
			Vitest.assert.deepStrictEqual(snapshot.pendingApprovals, [
				{
					approvalRequestId: secondApprovalRequestId,
					sessionId,
					sequence: 4
				}
			])
		})
	)
})

const RestartFs = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(RestartFs)("process restart", (it) => {
	it.effect("keeps an outstanding approval answerable after reopen", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const filename = path.join(dir, "acepe-restart.db")
			const live = () =>
				Layer.fresh(
					ProjectionPendingApprovalsLive.pipe(
						Layer.provideMerge(
							Layer.effectDiscard(
								Effect.gen(function*() {
									yield* runMigrations
									yield* applyPendingApprovalsMigration
								})
							).pipe(
								Layer.provideMerge(makeSqliteLayer({ filename, readonly: false }))
							)
						)
					)
				)
			yield* Effect.scoped(
				Effect.gen(function*() {
					const sql = yield* SqlClient.SqlClient
					const approvals = yield* ProjectionPendingApprovals
					yield* approvals.apply(requestEvent(3), sql)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(live())
				)
			)
			yield* Effect.scoped(
				Effect.gen(function*() {
					const sql = yield* SqlClient.SqlClient
					const approvals = yield* ProjectionPendingApprovals
					Vitest.assert.strictEqual(
						statusOf(yield* approvals.get(approvalRequestId)),
						"outstanding"
					)
					yield* approvals.apply(answerEvent(4), sql)
					Vitest.assert.strictEqual(
						statusOf(yield* approvals.get(approvalRequestId)),
						"missing"
					)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(live())
				)
			)
		})
	)
})
