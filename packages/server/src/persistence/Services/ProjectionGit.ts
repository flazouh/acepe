import {
	emptyProjectedGitReview,
	FileGitStatus,
	GitBlameLoadedPayload,
	GitDiffLoadedPayload,
	GitFileReview,
	GitHunkAcceptedPayload,
	GitHunkDecision,
	GitHunkRejectedPayload,
	GitStatusRefreshedPayload,
	type OrchestrationEvent,
	ProjectedGitReview,
	ProjectId,
	Sequence,
	TrimmedNonEmptyString,
	emptyGitFileReview
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_GIT_NAME = "projection.git"
export const PROJECTION_GIT_TABLE = "projection_git_review"

export type { ProjectedGitReview }

export const ProjectionGitRow = Schema.Struct({
	project_id: ProjectId,
	status_json: Schema.String,
	files_json: Schema.String,
	sequence: Sequence
})
export type ProjectionGitRow = typeof ProjectionGitRow.Type

export interface ProjectionGitShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly get: (
		projectId: ProjectId
	) => Effect.Effect<Option.Option<ProjectedGitReview>, SqlError | Schema.SchemaError>
}

export class ProjectionGit extends Context.Service<ProjectionGit, ProjectionGitShape>()(
	"@acepe/server/persistence/Services/ProjectionGit"
) {}

const decodeRow = Schema.decodeUnknownEffect(ProjectionGitRow)
const decodeStatus = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.NullOr(Schema.Array(FileGitStatus)))
)
const decodeFiles = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(GitFileReview)))
const encodeStatus = Schema.encodeEffect(
	Schema.fromJsonString(Schema.NullOr(Schema.Array(FileGitStatus)))
)
const encodeFiles = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(GitFileReview)))

export const encodeProjectedGitReview = Effect.fn("encodeProjectedGitReview")(function*(
	review: ProjectedGitReview
) {
	const statusJson = yield* encodeStatus(review.status)
	const filesJson = yield* encodeFiles(review.files)
	return {
		projectId: review.projectId,
		statusJson,
		filesJson,
		sequence: review.sequence
	}
})

export const decodeStoredProjectedGitReview = Effect.fn("decodeStoredProjectedGitReview")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		const status = yield* decodeStatus(row.status_json)
		const files = yield* decodeFiles(row.files_json)
		return {
			sequence: row.sequence,
			projectId: row.project_id,
			status,
			files
		} satisfies ProjectedGitReview
	}
)

const ignoreEvent = (
	current: Option.Option<ProjectedGitReview>
): Effect.Effect<Option.Option<ProjectedGitReview>> => Effect.succeed(current)

const currentOrEmpty = (
	current: Option.Option<ProjectedGitReview>,
	projectId: ProjectId,
	sequence: Sequence
): ProjectedGitReview =>
	Option.getOrElse(current, () => emptyProjectedGitReview(projectId, sequence))

const forProject = (
	current: Option.Option<ProjectedGitReview>,
	projectId: ProjectId,
	sequence: Sequence
): ProjectedGitReview => {
	const review = currentOrEmpty(current, projectId, sequence)
	if (review.projectId !== projectId) {
		return emptyProjectedGitReview(projectId, sequence)
	}
	return review
}

const upsertFile = (
	files: ReadonlyArray<GitFileReview>,
	path: GitFileReview["path"],
	update: (current: GitFileReview) => GitFileReview
): ReadonlyArray<GitFileReview> => {
	const existing = Arr.findFirst(files, (file) => file.path === path)
	const next = update(Option.getOrElse(existing, () => emptyGitFileReview(path)))
	if (Option.isNone(existing)) {
		return Arr.append(files, next)
	}
	return Arr.map(files, (file) => (file.path === path ? next : file))
}

const upsertDecision = (
	decisions: ReadonlyArray<GitHunkDecision>,
	next: GitHunkDecision
): ReadonlyArray<GitHunkDecision> => {
	const existing = Arr.findFirst(decisions, (row) => row.hunkIndex === next.hunkIndex)
	if (Option.isNone(existing)) {
		return Arr.append(decisions, next)
	}
	return Arr.map(decisions, (row) => (row.hunkIndex === next.hunkIndex ? next : row))
}

const projectStatusRefreshed = (
	current: Option.Option<ProjectedGitReview>,
	event: Extract<OrchestrationEvent, { readonly type: "GitStatusRefreshed" }>
): Effect.Effect<Option.Option<ProjectedGitReview>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(GitStatusRefreshedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const review = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				sequence: event.sequence,
				projectId: payload.projectId,
				status: payload.status,
				files: review.files
			})
		})
	)

const projectDiffLoaded = (
	current: Option.Option<ProjectedGitReview>,
	event: Extract<OrchestrationEvent, { readonly type: "GitDiffLoaded" }>
): Effect.Effect<Option.Option<ProjectedGitReview>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(GitDiffLoadedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const review = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				sequence: event.sequence,
				projectId: payload.projectId,
				status: review.status,
				files: upsertFile(review.files, payload.filePath, (file) => ({
					path: file.path,
					diff: payload.diff,
					patch: payload.patch,
					blame: file.blame,
					hunkDecisions: file.hunkDecisions
				}))
			})
		})
	)

const projectBlameLoaded = (
	current: Option.Option<ProjectedGitReview>,
	event: Extract<OrchestrationEvent, { readonly type: "GitBlameLoaded" }>
): Effect.Effect<Option.Option<ProjectedGitReview>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(GitBlameLoadedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const review = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				sequence: event.sequence,
				projectId: payload.projectId,
				status: review.status,
				files: upsertFile(review.files, payload.filePath, (file) => ({
					path: file.path,
					diff: file.diff,
					patch: file.patch,
					blame: payload.blame,
					hunkDecisions: file.hunkDecisions
				}))
			})
		})
	)

const projectHunkAccepted = (
	current: Option.Option<ProjectedGitReview>,
	event: Extract<OrchestrationEvent, { readonly type: "GitHunkAccepted" }>
): Effect.Effect<Option.Option<ProjectedGitReview>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(GitHunkAcceptedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const review = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				sequence: event.sequence,
				projectId: payload.projectId,
				status: review.status,
				files: upsertFile(review.files, payload.filePath, (file) => ({
					path: file.path,
					diff: file.diff,
					patch: file.patch,
					blame: file.blame,
					hunkDecisions: upsertDecision(file.hunkDecisions, {
						hunkIndex: payload.hunkIndex,
						action: "accepted"
					})
				}))
			})
		})
	)

const projectHunkRejected = (
	current: Option.Option<ProjectedGitReview>,
	event: Extract<OrchestrationEvent, { readonly type: "GitHunkRejected" }>
): Effect.Effect<Option.Option<ProjectedGitReview>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(GitHunkRejectedPayload)(event.payload).pipe(
		Effect.map((payload) => {
			const review = forProject(current, payload.projectId, event.sequence)
			return Option.some({
				sequence: event.sequence,
				projectId: payload.projectId,
				status: review.status,
				files: upsertFile(review.files, payload.filePath, (file) => ({
					path: file.path,
					diff:
						file.diff === null
							? null
							: {
									oldContent: file.diff.oldContent,
									newContent: payload.newContent,
									fileName: file.diff.fileName
								},
					patch: file.patch,
					blame: file.blame,
					hunkDecisions: upsertDecision(file.hunkDecisions, {
						hunkIndex: payload.hunkIndex,
						action: "rejected"
					})
				}))
			})
		})
	)

export const evolveProjectedGitReview = (
	current: Option.Option<ProjectedGitReview>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedGitReview>, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => ignoreEvent(current),
			ProjectMetaUpdated: () => ignoreEvent(current),
			ProjectDeleted: () => ignoreEvent(current),
			SessionCreated: () => ignoreEvent(current),
			SessionMetaUpdated: () => ignoreEvent(current),
			SessionArchived: () => ignoreEvent(current),
			SessionUnarchived: () => ignoreEvent(current),
			SessionDeleted: () => ignoreEvent(current),
			MessageSent: () => ignoreEvent(current),
			TokenAppended: () => ignoreEvent(current),
			TurnCancelled: () => ignoreEvent(current),
			CheckpointCreated: () => ignoreEvent(current),
			CheckpointReadinessChanged: () => ignoreEvent(current),
			CheckpointReverted: () => ignoreEvent(current),
			SettingsUpdated: () => ignoreEvent(current),
			SkillsDiscovered: () => ignoreEvent(current),
			VoiceModelsListed: () => ignoreEvent(current),
			VoiceLanguagesListed: () => ignoreEvent(current),
			VoiceModelStatusReported: () => ignoreEvent(current),
			VoiceModelDownloaded: () => ignoreEvent(current),
			VoiceModelDeleted: () => ignoreEvent(current),
			VoiceModelLoaded: () => ignoreEvent(current),
			VoiceRecordingStarted: () => ignoreEvent(current),
			VoiceRecordingStopped: () => ignoreEvent(current),
			VoiceRecordingCancelled: () => ignoreEvent(current),
			GitStatusRefreshed: (refreshed) => projectStatusRefreshed(current, refreshed),
			GitDiffLoaded: (loaded) => projectDiffLoaded(current, loaded),
			GitBlameLoaded: (loaded) => projectBlameLoaded(current, loaded),
			GitHunkAccepted: (accepted) => projectHunkAccepted(current, accepted),
			GitHunkRejected: (rejected) => projectHunkRejected(current, rejected),
			SessionResumed: () => ignoreEvent(current),
			SessionForked: () => ignoreEvent(current),
			SessionClosed: () => ignoreEvent(current),
			SessionModelSet: () => ignoreEvent(current),
			SessionModeSet: () => ignoreEvent(current),
			SessionAutonomousSet: () => ignoreEvent(current),
			SessionConfigOptionSet: () => ignoreEvent(current),
			InteractionReplied: () => ignoreEvent(current),
			InboundResponded: () => ignoreEvent(current),
			AgentInitialized: () => ignoreEvent(current),
			AgentInstalled: () => ignoreEvent(current),
			AgentUninstalled: () => ignoreEvent(current),
			AgentAuthenticated: () => ignoreEvent(current),
			AgentAuthenticationCancelled: () => ignoreEvent(current),
			AgentCustomRegistered: () => ignoreEvent(current),
			AgentsListed: () => ignoreEvent(current),
			SessionConnectionRefreshed: () => ignoreEvent(current),
			SessionStateRefreshed: () => ignoreEvent(current),
			TranscriptPageRead: () => ignoreEvent(current),
			TranscriptViewportRequested: () => ignoreEvent(current),
			PreconnectionCapabilitiesListed: () => ignoreEvent(current),
			PreconnectionCommandsListed: () => ignoreEvent(current),
			ComposerMcpCatalogLoaded: () => ignoreEvent(current),
			ComputerUseProbed: () => ignoreEvent(current),
			EventBridgeRefreshed: () => ignoreEvent(current),
			ToolCallObserved: () => ignoreEvent(current),
			ApprovalRequested: () => ignoreEvent(current)
		})
	)(event)
