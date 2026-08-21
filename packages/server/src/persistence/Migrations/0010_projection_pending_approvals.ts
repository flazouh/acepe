import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionPendingApprovals = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_pending_approvals (
			approval_request_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX projection_pending_approvals_session_sequence
		ON projection_pending_approvals (session_id, sequence)
	`.withoutTransform
})

export default projectionPendingApprovals
