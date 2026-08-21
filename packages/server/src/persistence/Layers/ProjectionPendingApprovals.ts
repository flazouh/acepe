import {
	ApprovalRequestId,
	type OrchestrationEvent,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedPendingApproval,
	evolveProjectedPendingApprovals,
	type ProjectedPendingApproval,
	PROJECTION_PENDING_APPROVALS_NAME,
	ProjectionPendingApprovals
} from "../Services/ProjectionPendingApprovals.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readByApprovalRequestId = Effect.fn("ProjectionPendingApprovals.readByApprovalRequestId")(
	function*(tx: SqlClient.SqlClient, approvalRequestId: ApprovalRequestId) {
		const rows = yield* tx`
			SELECT
				approval_request_id,
				session_id,
				sequence
			FROM projection_pending_approvals
			WHERE approval_request_id = ${approvalRequestId}
		`.withoutTransform
		return yield* Option.match(Arr.head(rows), {
			onNone: () => Effect.succeed(Option.none()),
			onSome: (row) => decodeStoredProjectedPendingApproval(row).pipe(Effect.map(Option.some))
		})
	}
)

const readBySession = Effect.fn("ProjectionPendingApprovals.readBySession")(function*(
	tx: SqlClient.SqlClient,
	sessionId: SessionId
) {
	const rows = yield* tx`
		SELECT
			approval_request_id,
			session_id,
			sequence
		FROM projection_pending_approvals
		WHERE session_id = ${sessionId}
		ORDER BY sequence ASC, approval_request_id ASC
	`.withoutTransform
	return yield* Effect.forEach(rows, decodeStoredProjectedPendingApproval)
})

const insert = Effect.fn("ProjectionPendingApprovals.insert")(function*(
	tx: SqlClient.SqlClient,
	row: ProjectedPendingApproval
) {
	yield* tx`
		INSERT INTO projection_pending_approvals (
			approval_request_id,
			session_id,
			sequence
		) VALUES (
			${row.approvalRequestId},
			${row.sessionId},
			${row.sequence}
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

const replaceSessionRows = Effect.fn("ProjectionPendingApprovals.replaceSessionRows")(function*(
	tx: SqlClient.SqlClient,
	sessionId: SessionId,
	rows: ReadonlyArray<ProjectedPendingApproval>
) {
	yield* tx`
		DELETE FROM projection_pending_approvals
		WHERE session_id = ${sessionId}
	`.withoutTransform.pipe(Effect.asVoid)
	yield* Effect.forEach(rows, (row) => insert(tx, row), { discard: true })
})

export const ProjectionPendingApprovalsLive = Layer.effect(ProjectionPendingApprovals)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_PENDING_APPROVALS_NAME)

		const apply = Effect.fn("ProjectionPendingApprovals.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			if (event.aggregateKind !== "session") {
				return
			}
			const current = yield* readBySession(tx, event.aggregateId)
			const next = yield* evolveProjectedPendingApprovals(current, event)
			if (next === current) {
				return
			}
			yield* replaceSessionRows(tx, event.aggregateId, next)
		})

		const truncate = Effect.fn("ProjectionPendingApprovals.truncate")(function*(
			tx: SqlClient.SqlClient
		) {
			yield* tx`DELETE FROM projection_pending_approvals`.withoutTransform.pipe(Effect.asVoid)
		})

		const listBySession = Effect.fn("ProjectionPendingApprovals.listBySession")(function*(
			sessionId: SessionId
		) {
			return yield* readBySession(sql, sessionId)
		})

		const get = Effect.fn("ProjectionPendingApprovals.get")(function*(
			approvalRequestId: ApprovalRequestId
		) {
			return yield* readByApprovalRequestId(sql, approvalRequestId)
		})

		return ProjectionPendingApprovals.of({
			name,
			apply,
			truncate,
			listBySession,
			get
		})
	})
)
