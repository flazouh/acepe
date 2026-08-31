import {
	type ApprovalRequestedFact,
	ApprovalRequestId,
	CommandId,
	EventId,
	pendingApprovalMetadata,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import { ProjectionApplyError } from "../../orchestration/Services/ProjectionPipeline.ts"
import { OrchestrationCommandReceiptsLive } from "../Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../Layers/OrchestrationEventStore.ts"
import { ProjectionPendingApprovalsLive } from "../Layers/ProjectionPendingApprovals.ts"
import { ProjectionStateLive } from "../Layers/ProjectionState.ts"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import { runMigrations } from "../Migrations.ts"
import {
	type NewOrchestrationEvent,
	OrchestrationEventStore
} from "../Services/OrchestrationEventStore.ts"
import {
	PROJECTION_PENDING_APPROVALS_NAME,
	ProjectionPendingApprovals
} from "../Services/ProjectionPendingApprovals.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import repairOrphanPendingApprovals from "./0037_repair_orphan_pending_approvals.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const deletedSessionId = SessionId.make("session-deleted")
const liveSessionId = SessionId.make("session-live")
const orphanApprovalId = ApprovalRequestId.make("approval-orphan")
const liveApprovalId = ApprovalRequestId.make("approval-live")
const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const requestedFact = (
	id: ApprovalRequestId,
	targetSessionId: SessionId
): ApprovalRequestedFact => ({
	type: "ApprovalRequested",
	approvalRequestId: id,
	sessionId: targetSessionId
})

const requestEvent = (
	index: number,
	id: ApprovalRequestId,
	targetSessionId: SessionId
): NewOrchestrationEvent => ({
	eventId: EventId.make(`event-${index}`),
	aggregateKind: "session",
	aggregateId: targetSessionId,
	occurredAt,
	commandId: CommandId.make(`cmd-${index}`),
	causationEventId: null,
	correlationId: CommandId.make(`cmd-${index}`),
	metadata: pendingApprovalMetadata(requestedFact(id, targetSessionId)),
	type: "SessionMetaUpdated",
	payload: { sessionId: targetSessionId }
})

const deleteEvent = (index: number, targetSessionId: SessionId): NewOrchestrationEvent => ({
	eventId: EventId.make(`event-${index}`),
	aggregateKind: "session",
	aggregateId: targetSessionId,
	occurredAt,
	commandId: CommandId.make(`cmd-${index}`),
	causationEventId: null,
	correlationId: CommandId.make(`cmd-${index}`),
	metadata: {},
	type: "SessionDeleted",
	payload: { sessionId: targetSessionId }
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

// Puts the database into the state a pre-fix install boots with: the event
// log holds a request and the delete of its session, but the fold never
// consumed SessionDeleted, so the projected row for the deleted session is
// still there, checkpointed as fully applied.
const seedOrphanedInstall = Effect.fn("seedOrphanedInstall")(function*() {
	const sql = yield* SqlClient.SqlClient
	const store = yield* OrchestrationEventStore
	const state = yield* ProjectionState
	const lastSequence = yield* store.append([
		requestEvent(1, orphanApprovalId, deletedSessionId),
		deleteEvent(2, deletedSessionId),
		requestEvent(3, liveApprovalId, liveSessionId)
	])
	const insertRow = (id: ApprovalRequestId, targetSessionId: SessionId, sequence: number) =>
		sql`
			INSERT INTO projection_pending_approvals (
				approval_request_id,
				session_id,
				sequence
			) VALUES (${id}, ${targetSessionId}, ${sequence})
		`.withoutTransform
	yield* insertRow(orphanApprovalId, deletedSessionId, 1)
	yield* insertRow(liveApprovalId, liveSessionId, 3)
	yield* state.checkpoint(PROJECTION_PENDING_APPROVALS_NAME, lastSequence)
	return lastSequence
})

const DumpRow = Schema.Struct({
	approval_request_id: Schema.String,
	session_id: Schema.String
})
const decodeDumpRows = Schema.decodeUnknownEffect(Schema.Array(DumpRow))

const dumpTable = Effect.fn("dumpProjectionPendingApprovals")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT approval_request_id, session_id
		FROM projection_pending_approvals
		ORDER BY approval_request_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const waitForSequence = Effect.fn("waitForSequence")(function*(
	name: string,
	sequence: number
) {
	const state = yield* ProjectionState
	let spins = 0
	while (true) {
		const current = yield* state.lastApplied(name)
		if (current === sequence) {
			return
		}
		spins = spins + 1
		if (spins > 200) {
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for sequence ${sequence}; lastApplied=${current}.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
})

Vitest.layer(isolatedEngine())("0037 clears the orphaned projection", (it) => {
	it.effect("removes every pending-approval row and the projector checkpoint", () =>
		Effect.gen(function*() {
			const state = yield* ProjectionState
			const lastSequence = yield* seedOrphanedInstall()
			Vitest.assert.strictEqual(
				yield* state.lastApplied(PROJECTION_PENDING_APPROVALS_NAME),
				lastSequence
			)
			yield* repairOrphanPendingApprovals
			Vitest.assert.deepStrictEqual(yield* dumpTable(), [])
			Vitest.assert.strictEqual(
				yield* state.lastApplied(PROJECTION_PENDING_APPROVALS_NAME),
				0
			)
		})
	)
})

// The whole repair, end to end: a database holding the orphan row boots, the
// migration clears the projection, and the pipeline's own catch-up folds the
// log back out with the fixed SessionDeleted handling, so only the approval
// whose session still exists comes back.
Vitest.layer(isolatedEngine())("0037 then replay drops only the orphan", (it) => {
	it.effect("rebuilds the live session's approval and not the deleted session's", () =>
		Effect.gen(function*() {
			const approvals = yield* ProjectionPendingApprovals
			const name = yield* decodeName(PROJECTION_PENDING_APPROVALS_NAME)
			const lastSequence = yield* seedOrphanedInstall()
			yield* repairOrphanPendingApprovals
			yield* Effect.scoped(
				Effect.gen(function*() {
					yield* waitForSequence(name, lastSequence)
					Vitest.assert.deepStrictEqual(yield* dumpTable(), [
						{
							approval_request_id: liveApprovalId,
							session_id: liveSessionId
						}
					])
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(
						Layer.fresh(
							ProjectionPipelineLive([
								{
									name,
									apply: approvals.apply,
									truncate: approvals.truncate
								}
							])
						)
					)
				)
			)
		})
	)
})
