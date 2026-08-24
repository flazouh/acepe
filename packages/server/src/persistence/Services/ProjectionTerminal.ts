import {
	type OrchestrationEvent,
	SessionId,
	TerminalCols,
	TerminalId,
	TerminalOutputAppendedPayload,
	TerminalRows,
	TrimmedNonEmptyString,
	type ProjectedTerminal,
	Sequence
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_TERMINAL_NAME = "projection.terminal"
export const PROJECTION_TERMINAL_TABLE = "projection_terminal"

const SqliteFlag = Schema.Literals([0, 1])

export const ProjectionTerminalRow = Schema.Struct({
	terminal_id: TerminalId,
	session_id: SessionId,
	cwd: TrimmedNonEmptyString,
	cols: TerminalCols,
	rows: TerminalRows,
	output: Schema.String,
	closed: SqliteFlag,
	sequence: Sequence
})
export type ProjectionTerminalRow = typeof ProjectionTerminalRow.Type

export interface ProjectionTerminalShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly get: (
		terminalId: TerminalId
	) => Effect.Effect<Option.Option<ProjectedTerminal>, SqlError | Schema.SchemaError>
}

export class ProjectionTerminal extends Context.Service<
	ProjectionTerminal,
	ProjectionTerminalShape
>()("@acepe/server/persistence/Services/ProjectionTerminal") {}

const decodeRow = Schema.decodeUnknownEffect(ProjectionTerminalRow)

export const decodeStoredProjectedTerminal = Effect.fn("decodeStoredProjectedTerminal")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return {
			sequence: row.sequence,
			terminalId: row.terminal_id,
			sessionId: row.session_id,
			cwd: row.cwd,
			cols: row.cols,
			rows: row.rows,
			output: row.output,
			closed: row.closed === 1
		} satisfies ProjectedTerminal
	}
)

const ignoreEvent = (
	current: Option.Option<ProjectedTerminal>
): Effect.Effect<Option.Option<ProjectedTerminal>> => Effect.succeed(current)

const fromSnapshotPayload = (
	event: Extract<
		OrchestrationEvent,
		{ readonly type: "TerminalOpened" | "TerminalOutputAppended" | "TerminalClosed" }
	>
): Effect.Effect<Option.Option<ProjectedTerminal>, Schema.SchemaError> =>
	Schema.decodeUnknownEffect(TerminalOutputAppendedPayload)(event.payload).pipe(
		Effect.map((payload) =>
			Option.some({
				sequence: event.sequence,
				terminalId: payload.terminalId,
				sessionId: payload.sessionId,
				cwd: payload.cwd,
				cols: payload.cols,
				rows: payload.rows,
				output: payload.output,
				closed: payload.closed
			} satisfies ProjectedTerminal)
		)
	)

export const evolveProjectedTerminal = (
	current: Option.Option<ProjectedTerminal>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedTerminal>, Schema.SchemaError> =>
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
			CheckpointFileReverted: () => ignoreEvent(current),
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
			GitStatusRefreshed: () => ignoreEvent(current),
			GitDiffLoaded: () => ignoreEvent(current),
			GitBlameLoaded: () => ignoreEvent(current),
			GitHunkAccepted: () => ignoreEvent(current),
			GitHunkRejected: () => ignoreEvent(current),
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
			ApprovalRequested: () => ignoreEvent(current),
			McpCatalogResolved: () => ignoreEvent(current),
			PreconnectionOptionsLoaded: () => ignoreEvent(current),
			TerminalOpened: (opened) => fromSnapshotPayload(opened),
			TerminalOutputAppended: (appended) => fromSnapshotPayload(appended),
			TerminalClosed: (closed) => fromSnapshotPayload(closed),
			SessionReviewFileMarked: () => ignoreEvent(current),
			SessionReviewStateCleared: () => ignoreEvent(current)
		})
	)(event)
