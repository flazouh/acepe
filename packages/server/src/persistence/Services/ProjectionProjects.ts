import {
	IsoDateTime,
	type OrchestrationEvent,
	ProjectCreatedPayload,
	ProjectDeletedPayload,
	ProjectId,
	ProjectMetaUpdatedPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_PROJECTS_NAME = "projection.projects"
export const PROJECTION_PROJECTS_TABLE = "projection_projects"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const ProjectedProject = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	deletedAt: Schema.NullOr(IsoDateTime),
	sessionCount: NonNegativeInt,
	scanWarmedAt: IsoDateTime
})
export type ProjectedProject = typeof ProjectedProject.Type

export const ProjectedProjectSession = Schema.Struct({
	sessionId: SessionId,
	projectId: ProjectId,
	deletedAt: Schema.NullOr(IsoDateTime)
})
export type ProjectedProjectSession = typeof ProjectedProjectSession.Type

export type ProjectedProjectsState = {
	readonly projects: HashMap.HashMap<ProjectId, ProjectedProject>
	readonly sessions: HashMap.HashMap<SessionId, ProjectedProjectSession>
}

const ProjectionProjectRow = Schema.Struct({
	project_id: ProjectId,
	title: TrimmedNonEmptyString,
	workspace_root: TrimmedNonEmptyString,
	created_at: IsoDateTime,
	updated_at: IsoDateTime,
	deleted_at: Schema.NullOr(IsoDateTime),
	session_count: NonNegativeInt,
	scan_warmed_at: IsoDateTime
})

const ProjectionProjectSessionRow = Schema.Struct({
	session_id: SessionId,
	project_id: ProjectId,
	deleted_at: Schema.NullOr(IsoDateTime)
})

export interface ProjectionProjectsShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly list: () => Effect.Effect<
		ReadonlyArray<ProjectedProject>,
		SqlError | Schema.SchemaError
	>
	readonly get: (
		projectId: ProjectId
	) => Effect.Effect<Option.Option<ProjectedProject>, SqlError | Schema.SchemaError>
}

export class ProjectionProjects extends Context.Service<
	ProjectionProjects,
	ProjectionProjectsShape
>()("@acepe/server/persistence/Services/ProjectionProjects") {}

const projectedProjectFromRow = (row: typeof ProjectionProjectRow.Type): ProjectedProject => ({
	projectId: row.project_id,
	title: row.title,
	workspaceRoot: row.workspace_root,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	deletedAt: row.deleted_at,
	sessionCount: row.session_count,
	scanWarmedAt: row.scan_warmed_at
})

const projectedProjectSessionFromRow = (
	row: typeof ProjectionProjectSessionRow.Type
): ProjectedProjectSession => ({
	sessionId: row.session_id,
	projectId: row.project_id,
	deletedAt: row.deleted_at
})

const decodeProjectRow = Schema.decodeUnknownEffect(ProjectionProjectRow)
const decodeSessionRow = Schema.decodeUnknownEffect(ProjectionProjectSessionRow)

export const decodeStoredProjectedProject = Effect.fn("decodeStoredProjectedProject")(
	function*(input: unknown) {
		const row = yield* decodeProjectRow(input)
		return projectedProjectFromRow(row)
	}
)

export const decodeStoredProjectedProjectSession = Effect.fn(
	"decodeStoredProjectedProjectSession"
)(function*(input: unknown) {
	const row = yield* decodeSessionRow(input)
	return projectedProjectSessionFromRow(row)
})

export const emptyProjectedProjectsState = (): ProjectedProjectsState => ({
	projects: HashMap.empty(),
	sessions: HashMap.empty()
})

export const isScanWarmed = (project: ProjectedProject): boolean =>
	project.scanWarmedAt.length > 0

const decodePayload = <S extends Schema.Top>(schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value)

const isActiveSession = (session: ProjectedProjectSession): boolean => session.deletedAt === null

const countActiveSessions = (
	sessions: HashMap.HashMap<SessionId, ProjectedProjectSession>,
	projectId: ProjectId
): number =>
	HashMap.reduce(sessions, 0, (total, session) => {
		if (session.projectId === projectId && isActiveSession(session)) {
			return total + 1
		}
		return total
	})

const putProject = (
	state: ProjectedProjectsState,
	project: ProjectedProject
): ProjectedProjectsState => ({
	projects: HashMap.set(state.projects, project.projectId, project),
	sessions: state.sessions
})

const putSession = (
	state: ProjectedProjectsState,
	session: ProjectedProjectSession
): ProjectedProjectsState => ({
	projects: state.projects,
	sessions: HashMap.set(state.sessions, session.sessionId, session)
})

const projectProjectCreated = (
	state: ProjectedProjectsState,
	event: Extract<OrchestrationEvent, { readonly type: "ProjectCreated" }>
): Effect.Effect<ProjectedProjectsState, Schema.SchemaError> =>
	decodePayload(ProjectCreatedPayload, event.payload).pipe(
		Effect.map((payload) => {
			const current = HashMap.get(state.projects, payload.projectId)
			const sessionCount = Option.match(current, {
				onNone: () => countActiveSessions(state.sessions, payload.projectId),
				onSome: (project) => project.sessionCount
			})
			return putProject(state, {
				projectId: payload.projectId,
				title: payload.title,
				workspaceRoot: payload.workspaceRoot,
				createdAt: event.occurredAt,
				updatedAt: event.occurredAt,
				deletedAt: null,
				sessionCount,
				scanWarmedAt: event.occurredAt
			})
		})
	)

const projectProjectMetaUpdated = (
	state: ProjectedProjectsState,
	event: Extract<OrchestrationEvent, { readonly type: "ProjectMetaUpdated" }>
): Effect.Effect<ProjectedProjectsState, Schema.SchemaError> =>
	decodePayload(ProjectMetaUpdatedPayload, event.payload).pipe(
		Effect.map((payload) =>
			Option.match(HashMap.get(state.projects, payload.projectId), {
				onNone: () => state,
				onSome: (project) =>
					putProject(state, {
						projectId: project.projectId,
						title: payload.title === undefined ? project.title : payload.title,
						workspaceRoot:
							payload.workspaceRoot === undefined
								? project.workspaceRoot
								: payload.workspaceRoot,
						createdAt: project.createdAt,
						updatedAt: event.occurredAt,
						deletedAt: project.deletedAt,
						sessionCount: project.sessionCount,
						scanWarmedAt: project.scanWarmedAt
					})
			})
		)
	)

const projectProjectDeleted = (
	state: ProjectedProjectsState,
	event: Extract<OrchestrationEvent, { readonly type: "ProjectDeleted" }>
): Effect.Effect<ProjectedProjectsState, Schema.SchemaError> =>
	decodePayload(ProjectDeletedPayload, event.payload).pipe(
		Effect.map((payload) =>
			Option.match(HashMap.get(state.projects, payload.projectId), {
				onNone: () => state,
				onSome: (project) =>
					putProject(state, {
						projectId: project.projectId,
						title: project.title,
						workspaceRoot: project.workspaceRoot,
						createdAt: project.createdAt,
						updatedAt: event.occurredAt,
						deletedAt: event.occurredAt,
						sessionCount: project.sessionCount,
						scanWarmedAt: project.scanWarmedAt
					})
			})
		)
	)

const projectSessionCreated = (
	state: ProjectedProjectsState,
	event: Extract<OrchestrationEvent, { readonly type: "SessionCreated" }>
): Effect.Effect<ProjectedProjectsState, Schema.SchemaError> =>
	decodePayload(SessionCreatedPayload, event.payload).pipe(
		Effect.map((payload) => {
			const existing = HashMap.get(state.sessions, payload.sessionId)
			if (Option.isSome(existing) && isActiveSession(existing.value)) {
				return state
			}
			const withSession = putSession(state, {
				sessionId: payload.sessionId,
				projectId: payload.projectId,
				deletedAt: null
			})
			return Option.match(HashMap.get(withSession.projects, payload.projectId), {
				onNone: () => withSession,
				onSome: (project) =>
					putProject(withSession, {
						projectId: project.projectId,
						title: project.title,
						workspaceRoot: project.workspaceRoot,
						createdAt: project.createdAt,
						updatedAt: project.updatedAt,
						deletedAt: project.deletedAt,
						sessionCount: project.sessionCount + 1,
						scanWarmedAt: project.scanWarmedAt
					})
			})
		})
	)

const projectSessionDeleted = (
	state: ProjectedProjectsState,
	event: Extract<OrchestrationEvent, { readonly type: "SessionDeleted" }>
): Effect.Effect<ProjectedProjectsState, Schema.SchemaError> =>
	decodePayload(SessionDeletedPayload, event.payload).pipe(
		Effect.map((payload) => {
			const existing = HashMap.get(state.sessions, payload.sessionId)
			if (Option.isNone(existing) || existing.value.deletedAt !== null) {
				return state
			}
			const withSession = putSession(state, {
				sessionId: existing.value.sessionId,
				projectId: existing.value.projectId,
				deletedAt: event.occurredAt
			})
			return Option.match(HashMap.get(withSession.projects, existing.value.projectId), {
				onNone: () => withSession,
				onSome: (project) =>
					putProject(withSession, {
						projectId: project.projectId,
						title: project.title,
						workspaceRoot: project.workspaceRoot,
						createdAt: project.createdAt,
						updatedAt: project.updatedAt,
						deletedAt: project.deletedAt,
						sessionCount: project.sessionCount === 0 ? 0 : project.sessionCount - 1,
						scanWarmedAt: project.scanWarmedAt
					})
			})
		})
	)

export const evolveProjectedProjects = (
	current: ProjectedProjectsState,
	event: OrchestrationEvent
): Effect.Effect<ProjectedProjectsState, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: (created) => projectProjectCreated(current, created),
			ProjectMetaUpdated: (updated) => projectProjectMetaUpdated(current, updated),
			ProjectDeleted: (deleted) => projectProjectDeleted(current, deleted),
			SessionCreated: (created) => projectSessionCreated(current, created),
			SessionMetaUpdated: () => Effect.succeed(current),
			SessionArchived: () => Effect.succeed(current),
			SessionUnarchived: () => Effect.succeed(current),
			SessionDeleted: (deleted) => projectSessionDeleted(current, deleted),
			MessageSent: () => Effect.succeed(current),
			TokenAppended: () => Effect.succeed(current),
			TurnCancelled: () => Effect.succeed(current)
		})
	)(event)
