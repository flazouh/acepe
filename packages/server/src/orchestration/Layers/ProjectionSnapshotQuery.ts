import { Sequence, SessionId } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeProjectedMessage,
	decodeProjectionSessionMessageStoredRows
} from "../../persistence/Services/ProjectionSessionMessages.ts"
import { decodeStoredProjectedSession } from "../../persistence/Services/ProjectionSessions.ts"
import {
	decodeStoredProjectedCheckpoints,
	PROJECTION_CHECKPOINTS_TABLE,
	type ProjectedCheckpoint
} from "../../persistence/Services/ProjectionCheckpoints.ts"
import {
	decodeStoredProjectedProject,
	PROJECTION_PROJECTS_TABLE,
	type ProjectedProject
} from "../../persistence/Services/ProjectionProjects.ts"
import {
	decodeProjectedPendingApprovals,
	decodeProjectedSessionActivities,
	decodeProjectedTurns,
	PROJECTION_PENDING_APPROVALS_TABLE,
	PROJECTION_SESSION_ACTIVITIES_TABLE,
	PROJECTION_TURNS_TABLE,
	type ProjectedPendingApproval,
	type ProjectedSessionActivity,
	type ProjectedTurn,
	ProjectionSnapshotQuery,
	SNAPSHOT_OPTIONAL_TABLES,
	SNAPSHOT_PROJECTOR_NAMES
} from "../Services/ProjectionSnapshotQuery.ts"

const SnapshotSequenceRow = Schema.Struct({
	snapshot_sequence: Sequence
})
const OptionalTableNameRow = Schema.Struct({
	name: Schema.String
})
const decodeSnapshotSequenceRows = Schema.decodeUnknownEffect(
	Schema.NonEmptyArray(SnapshotSequenceRow)
)
const decodeOptionalTableNameRows = Schema.decodeUnknownEffect(Schema.Array(OptionalTableNameRow))

export const ProjectionSnapshotQueryLive = Layer.effect(ProjectionSnapshotQuery)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient

		const readSnapshotSequence = Effect.fn("ProjectionSnapshotQuery.readSnapshotSequence")(
			function*() {
				const rows = yield* sql`
					SELECT COALESCE(MIN(last_applied_sequence), 0) AS snapshot_sequence
					FROM projection_state
					WHERE name IN ${sql.in(SNAPSHOT_PROJECTOR_NAMES)}
				`.withoutTransform
				const decoded = yield* decodeSnapshotSequenceRows(rows)
				return decoded[0].snapshot_sequence
			}
		)

		const readSession = Effect.fn("ProjectionSnapshotQuery.readSession")(function*(
			sessionId: SessionId
		) {
			const rows = yield* sql`
				SELECT
					session_id,
					project_id,
					title,
					provider,
					created_at,
					updated_at,
					last_activity_at,
					archived_at,
					deleted_at
				FROM projection_sessions
				WHERE session_id = ${sessionId}
			`.withoutTransform
			return yield* Option.match(Arr.head(rows), {
				onNone: () => Effect.succeed(null),
				onSome: decodeStoredProjectedSession
			})
		})

		const readMessages = Effect.fn("ProjectionSnapshotQuery.readMessages")(function*(
			sessionId: SessionId,
			snapshotSequence: Sequence
		) {
			const rows = yield* sql`
				SELECT
					session_id,
					sequence,
					message_id,
					turn_id,
					row_type,
					content
				FROM projection_session_messages
				WHERE session_id = ${sessionId}
					AND sequence <= ${snapshotSequence}
				ORDER BY sequence ASC
			`.withoutTransform
			const stored = yield* decodeProjectionSessionMessageStoredRows(rows)
			return yield* Effect.forEach(stored, decodeProjectedMessage)
		})

		const readPresentOptionalTables = Effect.fn(
			"ProjectionSnapshotQuery.readPresentOptionalTables"
		)(function*() {
			const rows = yield* sql`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
					AND name IN ${sql.in(SNAPSHOT_OPTIONAL_TABLES)}
			`.withoutTransform
			const decoded = yield* decodeOptionalTableNameRows(rows)
			return HashSet.fromIterable(Arr.map(decoded, (row) => row.name))
		})

		const readTurns = Effect.fn("ProjectionSnapshotQuery.readTurns")(function*(
			sessionId: SessionId,
			snapshotSequence: Sequence,
			present: HashSet.HashSet<string>
		) {
			if (!HashSet.has(present, PROJECTION_TURNS_TABLE)) {
				return Arr.empty<ProjectedTurn>()
			}
			const rows = yield* sql`
				SELECT turn_id, session_id, sequence
				FROM projection_turns
				WHERE session_id = ${sessionId}
					AND sequence <= ${snapshotSequence}
				ORDER BY sequence ASC
			`.withoutTransform
			return yield* decodeProjectedTurns(rows)
		})

		const readActivities = Effect.fn("ProjectionSnapshotQuery.readActivities")(function*(
			sessionId: SessionId,
			snapshotSequence: Sequence,
			present: HashSet.HashSet<string>
		) {
			if (!HashSet.has(present, PROJECTION_SESSION_ACTIVITIES_TABLE)) {
				return Arr.empty<ProjectedSessionActivity>()
			}
			const rows = yield* sql`
				SELECT activity_id, session_id, sequence
				FROM projection_session_activities
				WHERE session_id = ${sessionId}
					AND sequence <= ${snapshotSequence}
				ORDER BY sequence ASC
			`.withoutTransform
			return yield* decodeProjectedSessionActivities(rows)
		})

		const readPendingApprovals = Effect.fn("ProjectionSnapshotQuery.readPendingApprovals")(
			function*(
				sessionId: SessionId,
				snapshotSequence: Sequence,
				present: HashSet.HashSet<string>
			) {
				if (!HashSet.has(present, PROJECTION_PENDING_APPROVALS_TABLE)) {
					return Arr.empty<ProjectedPendingApproval>()
				}
				const rows = yield* sql`
					SELECT approval_request_id, session_id, sequence
					FROM projection_pending_approvals
					WHERE session_id = ${sessionId}
						AND sequence <= ${snapshotSequence}
					ORDER BY sequence ASC
				`.withoutTransform
				return yield* decodeProjectedPendingApprovals(rows)
			}
		)

		const readCheckpoints = Effect.fn("ProjectionSnapshotQuery.readCheckpoints")(function*(
			sessionId: SessionId,
			snapshotSequence: Sequence,
			present: HashSet.HashSet<string>
		) {
			if (!HashSet.has(present, PROJECTION_CHECKPOINTS_TABLE)) {
				return Arr.empty<ProjectedCheckpoint>()
			}
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
				WHERE session_id = ${sessionId}
					AND sequence <= ${snapshotSequence}
				ORDER BY checkpoint_number ASC
			`.withoutTransform
			return yield* decodeStoredProjectedCheckpoints(rows)
		})

		const readSnapshot = Effect.fn("ProjectionSnapshotQuery.readSnapshot")(function*(
			sessionId: SessionId
		) {
			const snapshotSequence = yield* readSnapshotSequence()
			const present = yield* readPresentOptionalTables()
			const session = yield* readSession(sessionId)
			const messages = yield* readMessages(sessionId, snapshotSequence)
			const turns = yield* readTurns(sessionId, snapshotSequence, present)
			const activities = yield* readActivities(sessionId, snapshotSequence, present)
			const pendingApprovals = yield* readPendingApprovals(
				sessionId,
				snapshotSequence,
				present
			)
			const checkpoints = yield* readCheckpoints(sessionId, snapshotSequence, present)
			return {
				snapshotSequence,
				session,
				messages,
				turns,
				activities,
				pendingApprovals,
				checkpoints
			}
		})

		const snapshot = Effect.fn("ProjectionSnapshotQuery.snapshot")(function*(
			sessionId: SessionId
		) {
			yield* Effect.annotateCurrentSpan({
				"projection.sessionId": sessionId
			})
			return yield* sql.withTransaction(readSnapshot(sessionId))
		})

		const readProjects = Effect.fn("ProjectionSnapshotQuery.readProjects")(function*() {
			const rows = yield* sql`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
					AND name = ${PROJECTION_PROJECTS_TABLE}
			`.withoutTransform
			if (Arr.isReadonlyArrayNonEmpty(rows) === false) {
				return Arr.empty<ProjectedProject>()
			}
			const projectRows = yield* sql`
				SELECT
					project_id,
					title,
					workspace_root,
					created_at,
					updated_at,
					deleted_at,
					session_count,
					scan_warmed_at
				FROM projection_projects
				ORDER BY updated_at DESC, project_id ASC
			`.withoutTransform
			return yield* Effect.forEach(projectRows, decodeStoredProjectedProject)
		})

		const listProjects = Effect.fn("ProjectionSnapshotQuery.listProjects")(function*() {
			return yield* sql.withTransaction(readProjects())
		})

		return ProjectionSnapshotQuery.of({
			snapshot,
			listProjects
		})
	})
)
