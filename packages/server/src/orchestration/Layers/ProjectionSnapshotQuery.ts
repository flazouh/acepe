import { APP_VOICE_ID, ProjectId, Sequence, SessionId, type SnapshotRequest, snapshotScope } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ProjectionSessionsLive } from "../../persistence/Layers/ProjectionSessions.ts"
import {
	decodeProjectedMessage,
	decodeProjectionSessionMessageStoredRows
} from "../../persistence/Services/ProjectionSessionMessages.ts"
import {
	decodeStoredProjectedSession,
	type ProjectedSession,
	ProjectionSessions
} from "../../persistence/Services/ProjectionSessions.ts"
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
	decodeStoredProjectedSettings,
	PROJECTION_SETTINGS_TABLE,
	type ProjectedSetting
} from "../../persistence/Services/ProjectionSettings.ts"
import {
	decodeStoredProjectedSkillsCatalog,
	PROJECTION_SKILLS_TABLE
} from "../../persistence/Services/ProjectionSkills.ts"
import {
	decodeStoredProjectedVoice,
	PROJECTION_VOICE_TABLE
} from "../../persistence/Services/ProjectionVoice.ts"
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
	type SessionProjectionSnapshot,
	SNAPSHOT_OPTIONAL_TABLES,
	SNAPSHOT_PROJECTOR_NAMES
} from "../Services/ProjectionSnapshotQuery.ts"

const PROJECTION_SESSIONS_TABLE = "projection_sessions"

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
		const projectedSessions = yield* ProjectionSessions

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
					deleted_at,
					pr_number,
					pr_link_mode
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

		const readSettings = Effect.fn("ProjectionSnapshotQuery.readSettings")(function*(
			snapshotSequence: Sequence,
			present: HashSet.HashSet<string>
		) {
			if (!HashSet.has(present, PROJECTION_SETTINGS_TABLE)) {
				return Arr.empty<ProjectedSetting>()
			}
			const rows = yield* sql`
				SELECT setting_key, setting_value, sequence
				FROM projection_settings
				WHERE sequence <= ${snapshotSequence}
				ORDER BY setting_key ASC
			`.withoutTransform
			return yield* decodeStoredProjectedSettings(rows)
		})

		const readSkillsCatalog = Effect.fn("ProjectionSnapshotQuery.readSkillsCatalog")(function*(
			snapshotSequence: Sequence,
			present: HashSet.HashSet<string>
		) {
			if (!HashSet.has(present, PROJECTION_SKILLS_TABLE)) {
				return null
			}
			const rows = yield* sql`
				SELECT
					catalog_id,
					agents_json,
					agent_skills_json,
					plugins_json,
					plugin_skills_json,
					tree_json,
					sequence
				FROM projection_skills_catalog
				WHERE catalog_id = 'app'
					AND sequence <= ${snapshotSequence}
			`.withoutTransform
			return yield* Option.match(Arr.head(rows), {
				onNone: () => Effect.succeed(null),
				onSome: decodeStoredProjectedSkillsCatalog
			})
		})

		const readVoice = Effect.fn("ProjectionSnapshotQuery.readVoice")(function*(
			snapshotSequence: Sequence,
			present: HashSet.HashSet<string>
		) {
			if (!HashSet.has(present, PROJECTION_VOICE_TABLE)) {
				return null
			}
			const rows = yield* sql`
				SELECT
					voice_id,
					models_json,
					languages_json,
					recording_json,
					last_transcription_json,
					sequence
				FROM projection_voice
				WHERE voice_id = ${APP_VOICE_ID}
					AND sequence <= ${snapshotSequence}
			`.withoutTransform
			return yield* Option.match(Arr.head(rows), {
				onNone: () => Effect.succeed(null),
				onSome: decodeStoredProjectedVoice
			})
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
			const settings = yield* readSettings(snapshotSequence, present)
			const skillsCatalog = yield* readSkillsCatalog(snapshotSequence, present)
			const voice = yield* readVoice(snapshotSequence, present)
			return {
				snapshotSequence,
				session,
				messages,
				turns,
				activities,
				pendingApprovals,
				checkpoints,
				projects: Arr.empty<ProjectedProject>(),
				sessions: Arr.empty<ProjectedSession>(),
				settings,
				skillsCatalog,
				voice
			} satisfies SessionProjectionSnapshot
		})

		const snapshot = Effect.fn("ProjectionSnapshotQuery.snapshot")(function*(
			sessionId: SessionId
		) {
			yield* Effect.annotateCurrentSpan({
				"projection.sessionId": sessionId
			})
			return yield* sql.withTransaction(readSnapshot(sessionId))
		})

		const tableExists = Effect.fn("ProjectionSnapshotQuery.tableExists")(function*(
			name: string
		) {
			const rows = yield* sql`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
					AND name = ${name}
			`.withoutTransform
			return Arr.isReadonlyArrayNonEmpty(rows)
		})

		const readProjects = Effect.fn("ProjectionSnapshotQuery.readProjects")(function*() {
			if ((yield* tableExists(PROJECTION_PROJECTS_TABLE)) === false) {
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

		const readSessions = Effect.fn("ProjectionSnapshotQuery.readSessions")(function*(
			projectId: ProjectId | null
		) {
			if ((yield* tableExists(PROJECTION_SESSIONS_TABLE)) === false) {
				return Arr.empty<ProjectedSession>()
			}
			if (projectId === null) {
				return yield* projectedSessions.list()
			}
			return yield* projectedSessions.listForProject(projectId)
		})

		const readLibrarySnapshot = Effect.fn("ProjectionSnapshotQuery.readLibrarySnapshot")(
			function*() {
				const snapshotSequence = yield* readSnapshotSequence()
				const present = yield* readPresentOptionalTables()
				const projects = yield* readProjects()
				const sessions = yield* readSessions(null)
				const settings = yield* readSettings(snapshotSequence, present)
				const skillsCatalog = yield* readSkillsCatalog(snapshotSequence, present)
				const voice = yield* readVoice(snapshotSequence, present)
				return {
					snapshotSequence,
					session: null,
					messages: Arr.empty(),
					turns: Arr.empty(),
					activities: Arr.empty(),
					pendingApprovals: Arr.empty(),
					checkpoints: Arr.empty(),
					projects,
					sessions,
					settings,
					skillsCatalog,
					voice
				} satisfies SessionProjectionSnapshot
			}
		)

		const readProjectSnapshot = Effect.fn("ProjectionSnapshotQuery.readProjectSnapshot")(
			function*(projectId: ProjectId) {
				const snapshotSequence = yield* readSnapshotSequence()
				const present = yield* readPresentOptionalTables()
				const projects = yield* readProjects()
				const matching = Arr.filter(projects, (project) => project.projectId === projectId)
				const sessions = yield* readSessions(projectId)
				const settings = yield* readSettings(snapshotSequence, present)
				const skillsCatalog = yield* readSkillsCatalog(snapshotSequence, present)
				const voice = yield* readVoice(snapshotSequence, present)
				return {
					snapshotSequence,
					session: null,
					messages: Arr.empty(),
					turns: Arr.empty(),
					activities: Arr.empty(),
					pendingApprovals: Arr.empty(),
					checkpoints: Arr.empty(),
					projects: matching,
					sessions,
					settings,
					skillsCatalog,
					voice
				} satisfies SessionProjectionSnapshot
			}
		)

		const readAppScopedSnapshot = Effect.fn("ProjectionSnapshotQuery.readAppScopedSnapshot")(
			function*() {
				const snapshotSequence = yield* readSnapshotSequence()
				const present = yield* readPresentOptionalTables()
				const settings = yield* readSettings(snapshotSequence, present)
				const skillsCatalog = yield* readSkillsCatalog(snapshotSequence, present)
				const voice = yield* readVoice(snapshotSequence, present)
				return {
					snapshotSequence,
					session: null,
					messages: Arr.empty(),
					turns: Arr.empty(),
					activities: Arr.empty(),
					pendingApprovals: Arr.empty(),
					checkpoints: Arr.empty(),
					projects: Arr.empty<ProjectedProject>(),
					sessions: Arr.empty<ProjectedSession>(),
					settings,
					skillsCatalog,
					voice
				} satisfies SessionProjectionSnapshot
			}
		)

		const forRequest = Effect.fn("ProjectionSnapshotQuery.forRequest")(function*(
			request: SnapshotRequest
		) {
			const scope = snapshotScope(request)
			return yield* Match.value(scope).pipe(
				Match.discriminatorsExhaustive("kind")({
					library: () => sql.withTransaction(readLibrarySnapshot()),
					settings: () => sql.withTransaction(readAppScopedSnapshot()),
					skills: () => sql.withTransaction(readAppScopedSnapshot()),
					voice: () => sql.withTransaction(readAppScopedSnapshot()),
					project: (projectRequest) =>
						sql.withTransaction(readProjectSnapshot(projectRequest.projectId)),
					session: (sessionRequest) => snapshot(sessionRequest.sessionId)
				})
			)
		})

		const listProjects = Effect.fn("ProjectionSnapshotQuery.listProjects")(function*() {
			return yield* sql.withTransaction(readProjects())
		})

		return ProjectionSnapshotQuery.of({
			snapshot,
			forRequest,
			listProjects
		})
	})
).pipe(Layer.provide(ProjectionSessionsLive))
