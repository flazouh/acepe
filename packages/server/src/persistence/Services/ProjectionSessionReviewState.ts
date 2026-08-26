import {
	type OrchestrationEvent,
	Sequence,
	SessionId,
	type SessionReviewFile,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_SESSION_REVIEW_STATE_NAME = "projection.session-review-state"
export const PROJECTION_SESSION_REVIEW_STATE_TABLE = "projection_session_review_state"

const SqliteFlag = Schema.Literals([0, 1])

export const ProjectionSessionReviewStateRow = Schema.Struct({
	session_id: SessionId,
	revision_key: TrimmedNonEmptyString,
	file_path: TrimmedNonEmptyString,
	reviewed: SqliteFlag,
	sequence: Sequence
})
export type ProjectionSessionReviewStateRow = typeof ProjectionSessionReviewStateRow.Type

export interface ProjectionSessionReviewStateShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly listBySession: (
		sessionId: SessionId
	) => Effect.Effect<ReadonlyArray<SessionReviewFile>, SqlError | Schema.SchemaError>
}

export class ProjectionSessionReviewState extends Context.Service<
	ProjectionSessionReviewState,
	ProjectionSessionReviewStateShape
>()("@acepe/server/persistence/Services/ProjectionSessionReviewState") {}

const decodeRow = Schema.decodeUnknownEffect(ProjectionSessionReviewStateRow)
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(ProjectionSessionReviewStateRow))

const reviewFileFromRow = (row: ProjectionSessionReviewStateRow): SessionReviewFile => ({
	revisionKey: row.revision_key,
	filePath: row.file_path,
	reviewed: row.reviewed === 1
})

export const decodeStoredSessionReviewFile = Effect.fn("decodeStoredSessionReviewFile")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return reviewFileFromRow(row)
	}
)

export const decodeStoredSessionReviewFiles = Effect.fn("decodeStoredSessionReviewFiles")(
	function*(input: unknown) {
		const rows = yield* decodeRows(input)
		return rows.map(reviewFileFromRow)
	}
)

// Unlike the single-row-per-aggregate projections (terminal, voice, mcp),
// this table holds many rows per session (one per revisionKey), and one of
// the two events this projector cares about (SessionReviewStateCleared)
// deletes every row for a session rather than upserting one. So the
// "evolve" step here yields an action for the Layer's apply() to execute,
// instead of the Option<value>-to-upsert shape the single-row projections
// use.
export type SessionReviewProjectionAction =
	| { readonly kind: "noop" }
	| {
			readonly kind: "upsert"
			readonly row: {
				readonly sessionId: SessionId
				readonly revisionKey: TrimmedNonEmptyString
				readonly filePath: TrimmedNonEmptyString
				readonly reviewed: boolean
				readonly sequence: Sequence
			}
	  }
	| { readonly kind: "clearSession"; readonly sessionId: SessionId }

const noop: SessionReviewProjectionAction = { kind: "noop" }

export const reviewProjectionActionForEvent = (
	event: OrchestrationEvent
): SessionReviewProjectionAction =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => noop,
			ProjectMetaUpdated: () => noop,
			ProjectDeleted: () => noop,
			SessionCreated: () => noop,
			SessionMetaUpdated: () => noop,
			SessionArchived: () => noop,
			SessionUnarchived: () => noop,
			SessionDeleted: () => noop,
			MessageSent: () => noop,
			TokenAppended: () => noop,
			TurnCancelled: () => noop,
			TurnCompleted: () => noop,
			CheckpointCreated: () => noop,
			CheckpointReadinessChanged: () => noop,
			CheckpointReverted: () => noop,
			CheckpointFileReverted: () => noop,
			SettingsUpdated: () => noop,
			SkillsDiscovered: () => noop,
			VoiceModelsListed: () => noop,
			VoiceLanguagesListed: () => noop,
			VoiceModelStatusReported: () => noop,
			VoiceModelDownloaded: () => noop,
			VoiceModelDeleted: () => noop,
			VoiceModelLoaded: () => noop,
			VoiceRecordingStarted: () => noop,
			VoiceRecordingStopped: () => noop,
			VoiceRecordingCancelled: () => noop,
			GitStatusRefreshed: () => noop,
			GitDiffLoaded: () => noop,
			GitBlameLoaded: () => noop,
			GitHunkAccepted: () => noop,
			GitHunkRejected: () => noop,
			SessionResumed: () => noop,
			SessionForked: () => noop,
			SessionClosed: () => noop,
			SessionModelSet: () => noop,
			SessionModeSet: () => noop,
			SessionAutonomousSet: () => noop,
			SessionConfigOptionSet: () => noop,
			InteractionReplied: () => noop,
			InboundResponded: () => noop,
			AgentInitialized: () => noop,
			AgentInstalled: () => noop,
			AgentUninstalled: () => noop,
			AgentAuthenticated: () => noop,
			AgentAuthenticationCancelled: () => noop,
			AgentCustomRegistered: () => noop,
			AgentsListed: () => noop,
			SessionConnectionRefreshed: () => noop,
			SessionStateRefreshed: () => noop,
			TranscriptPageRead: () => noop,
			TranscriptViewportRequested: () => noop,
			PreconnectionCapabilitiesListed: () => noop,
			PreconnectionCommandsListed: () => noop,
			ComposerMcpCatalogLoaded: () => noop,
			ComputerUseProbed: () => noop,
			EventBridgeRefreshed: () => noop,
			ToolCallObserved: () => noop,
			ApprovalRequested: () => noop,
			McpCatalogResolved: () => noop,
			PreconnectionOptionsLoaded: () => noop,
			TerminalOpened: () => noop,
			TerminalOutputAppended: () => noop,
			TerminalClosed: () => noop,
			SessionReviewFileMarked: (marked) => ({
				kind: "upsert" as const,
				row: {
					sessionId: marked.payload.sessionId,
					revisionKey: marked.payload.revisionKey,
					filePath: marked.payload.filePath,
					reviewed: marked.payload.reviewed,
					sequence: marked.sequence
				}
			}),
			SessionReviewStateCleared: (cleared) => ({
				kind: "clearSession" as const,
				sessionId: cleared.payload.sessionId
			}),
			ProviderSessionFailed: () => noop,
			TurnUsageObserved: () => noop
		})
	)(event)
