import {
	type OrchestrationEvent,
	ProjectId,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedProject,
	decodeStoredProjectedProjectSession,
	emptyProjectedProjectsState,
	evolveProjectedProjects,
	type ProjectedProject,
	type ProjectedProjectSession,
	type ProjectedProjectsState,
	PROJECTION_PROJECTS_NAME,
	ProjectionProjects
} from "../Services/ProjectionProjects.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)
const decodeSessionCreated = Schema.decodeUnknownEffect(SessionCreatedPayload)
const decodeSessionDeleted = Schema.decodeUnknownEffect(SessionDeletedPayload)

const projectMap = (
	project: Option.Option<ProjectedProject>
): HashMap.HashMap<ProjectId, ProjectedProject> =>
	Option.match(project, {
		onNone: () => HashMap.empty<ProjectId, ProjectedProject>(),
		onSome: (row) => HashMap.make([row.projectId, row])
	})

const sessionMap = (
	session: Option.Option<ProjectedProjectSession>
): HashMap.HashMap<SessionId, ProjectedProjectSession> =>
	Option.match(session, {
		onNone: () => HashMap.empty<SessionId, ProjectedProjectSession>(),
		onSome: (row) => HashMap.make([row.sessionId, row])
	})

const membershipMap = (
	sessions: ReadonlyArray<ProjectedProjectSession>
): HashMap.HashMap<SessionId, ProjectedProjectSession> =>
	Arr.reduce(
		sessions,
		HashMap.empty<SessionId, ProjectedProjectSession>(),
		(map, session) => HashMap.set(map, session.sessionId, session)
	)

const readProjectById = Effect.fn("ProjectionProjects.readProjectById")(function*(
	tx: SqlClient.SqlClient,
	projectId: ProjectId
) {
	const rows = yield* tx`
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
		WHERE project_id = ${projectId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedProject(row).pipe(Effect.map(Option.some))
	})
})

const readMembershipBySessionId = Effect.fn("ProjectionProjects.readMembershipBySessionId")(
	function*(tx: SqlClient.SqlClient, sessionId: SessionId) {
		const rows = yield* tx`
			SELECT session_id, project_id, deleted_at
			FROM projection_projects_membership
			WHERE session_id = ${sessionId}
		`.withoutTransform
		return yield* Option.match(Arr.head(rows), {
			onNone: () => Effect.succeed(Option.none()),
			onSome: (row) => decodeStoredProjectedProjectSession(row).pipe(Effect.map(Option.some))
		})
	}
)

const readMembershipsByProjectId = Effect.fn("ProjectionProjects.readMembershipsByProjectId")(
	function*(tx: SqlClient.SqlClient, projectId: ProjectId) {
		const rows = yield* tx`
			SELECT session_id, project_id, deleted_at
			FROM projection_projects_membership
			WHERE project_id = ${projectId}
		`.withoutTransform
		const decoded = yield* Effect.forEach(rows, decodeStoredProjectedProjectSession)
		return membershipMap(decoded)
	}
)

const sliceFromProjectCreated = Effect.fn("ProjectionProjects.sliceFromProjectCreated")(
	function*(tx: SqlClient.SqlClient, projectId: ProjectId) {
		const project = yield* readProjectById(tx, projectId)
		const sessions = yield* readMembershipsByProjectId(tx, projectId)
		return {
			projects: projectMap(project),
			sessions
		}
	}
)

const sliceFromProjectRow = Effect.fn("ProjectionProjects.sliceFromProjectRow")(function*(
	tx: SqlClient.SqlClient,
	projectId: ProjectId
) {
	const project = yield* readProjectById(tx, projectId)
	return {
		projects: projectMap(project),
		sessions: HashMap.empty<SessionId, ProjectedProjectSession>()
	}
})

const sliceFromSessionCreated = Effect.fn("ProjectionProjects.sliceFromSessionCreated")(
	function*(tx: SqlClient.SqlClient, event: OrchestrationEvent) {
		const payload = yield* decodeSessionCreated(event.payload)
		const project = yield* readProjectById(tx, payload.projectId)
		const membership = yield* readMembershipBySessionId(tx, payload.sessionId)
		return {
			projects: projectMap(project),
			sessions: sessionMap(membership)
		}
	}
)

const sliceFromSessionDeleted = Effect.fn("ProjectionProjects.sliceFromSessionDeleted")(
	function*(tx: SqlClient.SqlClient, event: OrchestrationEvent) {
		const payload = yield* decodeSessionDeleted(event.payload)
		const membership = yield* readMembershipBySessionId(tx, payload.sessionId)
		const project = yield* Option.match(membership, {
			onNone: () => Effect.succeed(Option.none<ProjectedProject>()),
			onSome: (row) => readProjectById(tx, row.projectId)
		})
		return {
			projects: projectMap(project),
			sessions: sessionMap(membership)
		}
	}
)

const ignoreEvent = () => Effect.succeed(emptyProjectedProjectsState())

const loadSlice = Effect.fn("ProjectionProjects.loadSlice")(function*(
	tx: SqlClient.SqlClient,
	event: OrchestrationEvent
) {
	return yield* Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: (created) => sliceFromProjectCreated(tx, created.aggregateId),
			ProjectMetaUpdated: (updated) => sliceFromProjectRow(tx, updated.aggregateId),
			ProjectDeleted: (deleted) => sliceFromProjectRow(tx, deleted.aggregateId),
			SessionCreated: (created) => sliceFromSessionCreated(tx, created),
			SessionDeleted: (deleted) => sliceFromSessionDeleted(tx, deleted),
			SessionMetaUpdated: ignoreEvent,
			SessionArchived: ignoreEvent,
			SessionUnarchived: ignoreEvent,
			MessageSent: ignoreEvent,
			TokenAppended: ignoreEvent,
			TurnCancelled: ignoreEvent,
			CheckpointCreated: ignoreEvent,
			CheckpointReadinessChanged: ignoreEvent,
			CheckpointReverted: ignoreEvent,
			SettingsUpdated: ignoreEvent,
			SkillsDiscovered: ignoreEvent,
			VoiceModelsListed: ignoreEvent,
			VoiceLanguagesListed: ignoreEvent,
			VoiceModelStatusReported: ignoreEvent,
			VoiceModelDownloaded: ignoreEvent,
			VoiceModelDeleted: ignoreEvent,
			VoiceModelLoaded: ignoreEvent,
			VoiceRecordingStarted: ignoreEvent,
			VoiceRecordingStopped: ignoreEvent,
			VoiceRecordingCancelled: ignoreEvent,
			GitStatusRefreshed: ignoreEvent,
			GitDiffLoaded: ignoreEvent,
			GitBlameLoaded: ignoreEvent,
			GitHunkAccepted: ignoreEvent,
			GitHunkRejected: ignoreEvent,
			SessionResumed: ignoreEvent,
			SessionForked: ignoreEvent,
			SessionClosed: ignoreEvent,
			SessionModelSet: ignoreEvent,
			SessionModeSet: ignoreEvent,
			SessionAutonomousSet: ignoreEvent,
			SessionConfigOptionSet: ignoreEvent,
			InteractionReplied: ignoreEvent,
			InboundResponded: ignoreEvent,
			AgentInitialized: ignoreEvent,
			AgentInstalled: ignoreEvent,
			AgentUninstalled: ignoreEvent,
			AgentAuthenticated: ignoreEvent,
			AgentAuthenticationCancelled: ignoreEvent,
			AgentCustomRegistered: ignoreEvent,
			AgentsListed: ignoreEvent,
			SessionConnectionRefreshed: ignoreEvent,
			SessionStateRefreshed: ignoreEvent,
			TranscriptPageRead: ignoreEvent,
			TranscriptViewportRequested: ignoreEvent,
			PreconnectionCapabilitiesListed: ignoreEvent,
			PreconnectionCommandsListed: ignoreEvent,
			ComposerMcpCatalogLoaded: ignoreEvent,
			ComputerUseProbed: ignoreEvent,
			EventBridgeRefreshed: ignoreEvent,
			ToolCallObserved: ignoreEvent,
			ApprovalRequested: ignoreEvent
		})
	)(event)
})

const upsertProject = Effect.fn("ProjectionProjects.upsertProject")(function*(
	tx: SqlClient.SqlClient,
	project: ProjectedProject
) {
	yield* tx`
		INSERT INTO projection_projects (
			project_id,
			title,
			workspace_root,
			created_at,
			updated_at,
			deleted_at,
			session_count,
			scan_warmed_at
		) VALUES (
			${project.projectId},
			${project.title},
			${project.workspaceRoot},
			${project.createdAt},
			${project.updatedAt},
			${project.deletedAt},
			${project.sessionCount},
			${project.scanWarmedAt}
		)
		ON CONFLICT(project_id) DO UPDATE SET
			title = excluded.title,
			workspace_root = excluded.workspace_root,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			deleted_at = excluded.deleted_at,
			session_count = excluded.session_count,
			scan_warmed_at = excluded.scan_warmed_at
	`.withoutTransform.pipe(Effect.asVoid)
})

const upsertMembership = Effect.fn("ProjectionProjects.upsertMembership")(function*(
	tx: SqlClient.SqlClient,
	session: ProjectedProjectSession
) {
	yield* tx`
		INSERT INTO projection_projects_membership (
			session_id,
			project_id,
			deleted_at
		) VALUES (
			${session.sessionId},
			${session.projectId},
			${session.deletedAt}
		)
		ON CONFLICT(session_id) DO UPDATE SET
			project_id = excluded.project_id,
			deleted_at = excluded.deleted_at
	`.withoutTransform.pipe(Effect.asVoid)
})

const persistSlice = Effect.fn("ProjectionProjects.persistSlice")(function*(
	tx: SqlClient.SqlClient,
	next: ProjectedProjectsState
) {
	yield* Effect.forEach(HashMap.values(next.projects), (project) => upsertProject(tx, project), {
		discard: true
	})
	yield* Effect.forEach(HashMap.values(next.sessions), (session) => upsertMembership(tx, session), {
		discard: true
	})
})

export const ProjectionProjectsLive = Layer.effect(ProjectionProjects)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_PROJECTS_NAME)

		const apply = Effect.fn("ProjectionProjects.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current = yield* loadSlice(tx, event)
			const next = yield* evolveProjectedProjects(current, event)
			yield* persistSlice(tx, next)
		})

		const truncate = Effect.fn("ProjectionProjects.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_projects_membership`.withoutTransform.pipe(Effect.asVoid)
			yield* tx`DELETE FROM projection_projects`.withoutTransform.pipe(Effect.asVoid)
		})

		const list = Effect.fn("ProjectionProjects.list")(function*() {
			const rows = yield* sql`
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
			return yield* Effect.forEach(rows, decodeStoredProjectedProject)
		})

		const get = Effect.fn("ProjectionProjects.get")(function*(projectId: ProjectId) {
			return yield* readProjectById(sql, projectId)
		})

		return ProjectionProjects.of({
			name,
			apply,
			truncate,
			list,
			get
		})
	})
)
