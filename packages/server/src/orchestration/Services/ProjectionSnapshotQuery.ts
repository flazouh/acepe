import {
	ActivityId,
	ApprovalRequestId,
	ProjectId,
	Sequence,
	SessionId,
	TurnId,
	type SnapshotRequest
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { ProjectedProject } from "../../persistence/Services/ProjectionProjects.ts"
import { ProjectedSession } from "../../persistence/Services/ProjectionSessions.ts"
import { ProjectionSessionMessage } from "../../persistence/Services/ProjectionSessionMessages.ts"
import {
	PROJECTION_CHECKPOINTS_TABLE,
	ProjectedCheckpoint
} from "../../persistence/Services/ProjectionCheckpoints.ts"

export const SNAPSHOT_PROJECTOR_NAMES = [
	"projection.sessions",
	"projection.session-messages",
	"projection.turns",
	"projection.session-activities",
	"projection.pending-approvals",
	"projection.checkpoints",
	"projection.projects"
] as const

export const PROJECTION_TURNS_TABLE = "projection_turns"
export const PROJECTION_SESSION_ACTIVITIES_TABLE = "projection_session_activities"
export const PROJECTION_PENDING_APPROVALS_TABLE = "projection_pending_approvals"

export const SNAPSHOT_OPTIONAL_TABLES = [
	PROJECTION_TURNS_TABLE,
	PROJECTION_SESSION_ACTIVITIES_TABLE,
	PROJECTION_PENDING_APPROVALS_TABLE,
	PROJECTION_CHECKPOINTS_TABLE
] as const

export const ProjectedTurn = Schema.Struct({
	turnId: TurnId,
	sessionId: SessionId,
	sequence: Sequence
})
export type ProjectedTurn = typeof ProjectedTurn.Type

export const ProjectedSessionActivity = Schema.Struct({
	activityId: ActivityId,
	sessionId: SessionId,
	sequence: Sequence
})
export type ProjectedSessionActivity = typeof ProjectedSessionActivity.Type

export const ProjectedPendingApproval = Schema.Struct({
	approvalRequestId: ApprovalRequestId,
	sessionId: SessionId,
	sequence: Sequence
})
export type ProjectedPendingApproval = typeof ProjectedPendingApproval.Type

export const SessionProjectionSnapshot = Schema.Struct({
	snapshotSequence: Sequence,
	session: Schema.NullOr(ProjectedSession),
	messages: Schema.Array(ProjectionSessionMessage),
	turns: Schema.Array(ProjectedTurn),
	activities: Schema.Array(ProjectedSessionActivity),
	pendingApprovals: Schema.Array(ProjectedPendingApproval),
	checkpoints: Schema.Array(ProjectedCheckpoint),
	projects: Schema.Array(ProjectedProject),
	sessions: Schema.Array(ProjectedSession)
})
export type SessionProjectionSnapshot = typeof SessionProjectionSnapshot.Type

export const ProjectedTurnStoredRow = Schema.Struct({
	turn_id: TurnId,
	session_id: SessionId,
	sequence: Sequence
})
export type ProjectedTurnStoredRow = typeof ProjectedTurnStoredRow.Type

export const ProjectedSessionActivityStoredRow = Schema.Struct({
	activity_id: ActivityId,
	session_id: SessionId,
	sequence: Sequence
})
export type ProjectedSessionActivityStoredRow = typeof ProjectedSessionActivityStoredRow.Type

export const ProjectedPendingApprovalStoredRow = Schema.Struct({
	approval_request_id: ApprovalRequestId,
	session_id: SessionId,
	sequence: Sequence
})
export type ProjectedPendingApprovalStoredRow = typeof ProjectedPendingApprovalStoredRow.Type

const decodeProjectedTurnStoredRows = Schema.decodeUnknownEffect(
	Schema.Array(ProjectedTurnStoredRow)
)
const decodeProjectedSessionActivityStoredRows = Schema.decodeUnknownEffect(
	Schema.Array(ProjectedSessionActivityStoredRow)
)
const decodeProjectedPendingApprovalStoredRows = Schema.decodeUnknownEffect(
	Schema.Array(ProjectedPendingApprovalStoredRow)
)
export const decodeSessionProjectionSnapshot = Schema.decodeUnknownEffect(SessionProjectionSnapshot)

const projectedTurnFromRow = (row: ProjectedTurnStoredRow): ProjectedTurn => ({
	turnId: row.turn_id,
	sessionId: row.session_id,
	sequence: row.sequence
})

const projectedSessionActivityFromRow = (
	row: ProjectedSessionActivityStoredRow
): ProjectedSessionActivity => ({
	activityId: row.activity_id,
	sessionId: row.session_id,
	sequence: row.sequence
})

const projectedPendingApprovalFromRow = (
	row: ProjectedPendingApprovalStoredRow
): ProjectedPendingApproval => ({
	approvalRequestId: row.approval_request_id,
	sessionId: row.session_id,
	sequence: row.sequence
})

export const decodeProjectedTurns = Effect.fn("decodeProjectedTurns")(function*(input: unknown) {
	const rows = yield* decodeProjectedTurnStoredRows(input)
	return Arr.map(rows, projectedTurnFromRow)
})

export const decodeProjectedSessionActivities = Effect.fn("decodeProjectedSessionActivities")(
	function*(input: unknown) {
		const rows = yield* decodeProjectedSessionActivityStoredRows(input)
		return Arr.map(rows, projectedSessionActivityFromRow)
	}
)

export const decodeProjectedPendingApprovals = Effect.fn("decodeProjectedPendingApprovals")(
	function*(input: unknown) {
		const rows = yield* decodeProjectedPendingApprovalStoredRows(input)
		return Arr.map(rows, projectedPendingApprovalFromRow)
	}
)

export {
	decodeStoredProjectedCheckpoint,
	decodeStoredProjectedCheckpoints
} from "../../persistence/Services/ProjectionCheckpoints.ts"

export interface ProjectionSnapshotQueryShape {
	readonly snapshot: (
		sessionId: SessionId
	) => Effect.Effect<SessionProjectionSnapshot, SqlError | Schema.SchemaError>
	readonly forRequest: (
		request: SnapshotRequest
	) => Effect.Effect<SessionProjectionSnapshot, SqlError | Schema.SchemaError>
	readonly listProjects: () => Effect.Effect<
		ReadonlyArray<ProjectedProject>,
		SqlError | Schema.SchemaError
	>
}

export class ProjectionSnapshotQuery extends Context.Service<
	ProjectionSnapshotQuery,
	ProjectionSnapshotQueryShape
>()("@acepe/server/orchestration/Services/ProjectionSnapshotQuery") {}
