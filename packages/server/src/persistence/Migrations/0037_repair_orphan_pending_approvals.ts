import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// A data repair, not a schema change.
//
// Until the SessionDeleted fix the pending-approvals fold never consumed
// SessionDeleted, so a session deleted while an approval was still
// unanswered left that approval's row in projection_pending_approvals
// forever. Nothing could ever answer it: the session was gone.
//
// The row cannot be repaired in place without re-deriving which sessions
// are deleted, and the orchestration event log already knows. Clearing the
// table and dropping the projector's checkpoint leaves ProjectionPipeline's
// own catch-up to replay every event from sequence 0 the next time it
// starts, which bootstrap does straight after migrations run. The fixed
// fold clears a session's rows when its SessionDeleted event replays, so
// the rebuilt table holds only approvals whose sessions still exist.
//
// Nothing else writes this table: every row it holds comes from the fold
// this replay re-runs, so the truncate loses nothing the log cannot
// restore.
//
// The projector name is a literal, not the PROJECTION_PENDING_APPROVALS_NAME
// constant. A migration records what was true when it ran; renaming the
// projector later must not silently retarget this one.
const repairOrphanPendingApprovals = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		DELETE FROM projection_pending_approvals
	`.withoutTransform
	yield* sql`
		DELETE FROM projection_state
		WHERE name = 'projection.pending-approvals'
	`.withoutTransform
})

export default repairOrphanPendingApprovals
