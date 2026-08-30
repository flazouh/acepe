import {
	IsoDateTime,
	type OrchestrationEvent,
	defaultProjectColor,
	ProjectColor,
	ProjectCreatedPayload,
	ProjectDeletedPayload,
	PROJECT_ICON_AUTO,
	PROJECT_ICON_NONE,
	ProjectIcon,
	ProjectIconRelativePath,
	ProjectId,
	ProjectMetaUpdatedPayload,
	ProjectSortOrder,
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

const SqliteFlag = Schema.Literals([0, 1])

/**
 * Hiding provider sessions Acepe never started is what makes the sidebar
 * useful, so an untouched project starts hidden. The toggle stays
 * per-project and reversible.
 */
export const DEFAULT_SHOW_EXTERNAL_CLI_SESSIONS = false

export const ProjectedProject = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	deletedAt: Schema.NullOr(IsoDateTime),
	sessionCount: NonNegativeInt,
	// Never null downstream: a project that predates the color column, or that
	// nobody has recolored, still projects the deterministic default.
	color: ProjectColor,
	// Never null downstream: a project that predates the column, or that
	// nobody has toggled, projects the useful default -- external provider
	// sessions stay hidden.
	showExternalCliSessions: Schema.Boolean,
	// The project's dense rank in the sidebar. null means nobody has ever
	// ordered this project, which is how every project starts and where a
	// freshly added one stays until the first move ranks the whole list.
	sortOrder: Schema.NullOr(ProjectSortOrder),
	// Never null downstream: a project that predates the icon columns, or that
	// nobody has given an icon, projects the "auto" choice and lets the read
	// path detect one. Only the choice lives here; the picture it resolves to
	// is derived from the project's files and is deliberately not stored.
	icon: ProjectIcon,
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
	color: Schema.NullOr(ProjectColor),
	// A row written before migration 0030 has no such column at all, and the
	// 0021 colour migration test reads exactly that shape. Absent and null both
	// mean the project never chose, which is the same as hiding.
	show_external_cli_sessions: SqliteFlag.pipe(Schema.NullOr, Schema.optionalKey),
	// Required, unlike the colour and visibility columns above: migration 0033
	// gives every row the column, so an absent one means a SELECT forgot to ask
	// for it. That is exactly how the sidebar rank first shipped half working,
	// and a required key turns the next such omission into a decode failure
	// instead of a project that reads as never ranked.
	sort_order: Schema.NullOr(ProjectSortOrder),
	// Two columns for one choice, because SQLite has no union type. Both null
	// is "auto", which is what every row predating migration 0035 holds and
	// why that migration needs no backfill. They are read as a pair exactly
	// once, in projectIconFromRow, so nothing downstream sees the split.
	icon_kind: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
	icon_path: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
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

const isProjectIconRelativePath = Schema.is(ProjectIconRelativePath)

/**
 * Rebuild the icon choice from the two columns that hold it.
 *
 * Anything the pair cannot express means "auto": both columns null (every row
 * older than migration 0035), a kind nobody recognises, or a custom pick whose
 * path no longer decodes. Falling back rather than failing is deliberate here.
 * A project whose stored icon path went bad should show the detected icon or
 * its letter, not refuse to load the sidebar.
 */
const projectIconFromRow = (
	kind: string | null | undefined,
	path: string | null | undefined
): ProjectIcon => {
	if (kind === "none") {
		return PROJECT_ICON_NONE
	}
	if (kind === "custom" && isProjectIconRelativePath(path)) {
		return { kind: "custom", path }
	}
	return PROJECT_ICON_AUTO
}

/** Split the icon choice back into the pair of columns that store it. */
export const projectIconToRow = (
	icon: ProjectIcon
): { readonly kind: string; readonly path: string | null } =>
	icon.kind === "custom" ? { kind: "custom", path: icon.path } : { kind: icon.kind, path: null }

const projectedProjectFromRow = (row: typeof ProjectionProjectRow.Type): ProjectedProject => ({
	projectId: row.project_id,
	title: row.title,
	workspaceRoot: row.workspace_root,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	deletedAt: row.deleted_at,
	sessionCount: row.session_count,
	color: row.color ?? defaultProjectColor(row.workspace_root),
	showExternalCliSessions: row.show_external_cli_sessions === null ||
			row.show_external_cli_sessions === undefined
		? DEFAULT_SHOW_EXTERNAL_CLI_SESSIONS
		: row.show_external_cli_sessions === 1,
	sortOrder: row.sort_order,
	icon: projectIconFromRow(row.icon_kind, row.icon_path),
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
			const color = Option.match(current, {
				onNone: () => defaultProjectColor(payload.workspaceRoot),
				onSome: (project) => project.color
			})
			const showExternalCliSessions = Option.match(current, {
				onNone: () => DEFAULT_SHOW_EXTERNAL_CLI_SESSIONS,
				onSome: (project) => project.showExternalCliSessions
			})
			const sortOrder = Option.match(current, {
				onNone: () => null,
				onSome: (project) => project.sortOrder
			})
			const icon = Option.match(current, {
				onNone: (): ProjectIcon => PROJECT_ICON_AUTO,
				onSome: (project) => project.icon
			})
			return putProject(state, {
				projectId: payload.projectId,
				title: payload.title,
				workspaceRoot: payload.workspaceRoot,
				createdAt: event.occurredAt,
				updatedAt: event.occurredAt,
				deletedAt: null,
				sessionCount,
				color,
				showExternalCliSessions,
				sortOrder,
				icon,
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
						color: payload.color === undefined ? project.color : payload.color,
						showExternalCliSessions: payload.showExternalCliSessions === undefined
							? project.showExternalCliSessions
							: payload.showExternalCliSessions,
						sortOrder: payload.sortOrder === undefined ? project.sortOrder : payload.sortOrder,
						icon: payload.icon === undefined ? project.icon : payload.icon,
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
						color: project.color,
						showExternalCliSessions: project.showExternalCliSessions,
						sortOrder: project.sortOrder,
						icon: project.icon,
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
						color: project.color,
						showExternalCliSessions: project.showExternalCliSessions,
						sortOrder: project.sortOrder,
						icon: project.icon,
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
						color: project.color,
						showExternalCliSessions: project.showExternalCliSessions,
						sortOrder: project.sortOrder,
						icon: project.icon,
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

			TurnCancelled: () => Effect.succeed(current),
			TurnCompleted: () => Effect.succeed(current),
			CheckpointCreated: () => Effect.succeed(current),
			CheckpointReadinessChanged: () => Effect.succeed(current),
			CheckpointReverted: () => Effect.succeed(current),
			CheckpointFileReverted: () => Effect.succeed(current),
			SettingsUpdated: () => Effect.succeed(current),
			SkillsDiscovered: () => Effect.succeed(current),
			VoiceModelsListed: () => Effect.succeed(current),
			VoiceLanguagesListed: () => Effect.succeed(current),
			VoiceModelStatusReported: () => Effect.succeed(current),
			VoiceModelDownloaded: () => Effect.succeed(current),
			VoiceModelDeleted: () => Effect.succeed(current),
			VoiceModelLoaded: () => Effect.succeed(current),
			VoiceRecordingStarted: () => Effect.succeed(current),
			VoiceRecordingStopped: () => Effect.succeed(current),
			VoiceRecordingCancelled: () => Effect.succeed(current),
			VoiceAmplitudeObserved: () => Effect.succeed(current),
			VoiceModelDownloadProgressed: () => Effect.succeed(current),
			GitStatusRefreshed: () => Effect.succeed(current),
			GitDiffLoaded: () => Effect.succeed(current),
			GitBlameLoaded: () => Effect.succeed(current),
			GitHunkAccepted: () => Effect.succeed(current),
			GitHunkRejected: () => Effect.succeed(current),
			SessionResumed: () => Effect.succeed(current),
			SessionForked: () => Effect.succeed(current),
			SessionClosed: () => Effect.succeed(current),
			SessionModelSet: () => Effect.succeed(current),
			SessionModeSet: () => Effect.succeed(current),
			SessionAutonomousSet: () => Effect.succeed(current),
			SessionConfigOptionSet: () => Effect.succeed(current),
			InteractionReplied: () => Effect.succeed(current),
			InboundResponded: () => Effect.succeed(current),
			AgentInitialized: () => Effect.succeed(current),
			AgentInstalled: () => Effect.succeed(current),
			AgentUninstalled: () => Effect.succeed(current),
			AgentAuthenticated: () => Effect.succeed(current),
			AgentAuthenticationCancelled: () => Effect.succeed(current),
			AgentCustomRegistered: () => Effect.succeed(current),
			AgentsListed: () => Effect.succeed(current),
			SessionConnectionRefreshed: () => Effect.succeed(current),
			SessionStateRefreshed: () => Effect.succeed(current),
			TranscriptPageRead: () => Effect.succeed(current),
			TranscriptViewportRequested: () => Effect.succeed(current),
			PreconnectionCapabilitiesListed: () => Effect.succeed(current),
			PreconnectionCommandsListed: () => Effect.succeed(current),
			ComposerMcpCatalogLoaded: () => Effect.succeed(current),
			ComputerUseProbed: () => Effect.succeed(current),
			EventBridgeRefreshed: () => Effect.succeed(current),
			ToolCallObserved: () => Effect.succeed(current),
			ApprovalRequested: () => Effect.succeed(current),
			McpCatalogResolved: () => Effect.succeed(current),
			PreconnectionOptionsLoaded: () => Effect.succeed(current),
			TerminalOpened: () => Effect.succeed(current),
			TerminalOutputAppended: () => Effect.succeed(current),
			TerminalClosed: () => Effect.succeed(current),
			SessionReviewFileMarked: () => Effect.succeed(current),
			SessionReviewStateCleared: () => Effect.succeed(current),
			ProviderSessionFailed: () => Effect.succeed(current),
			TurnUsageObserved: () => Effect.succeed(current)
		})
	)(event)
