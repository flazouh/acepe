import {
	type OrchestrationEvent,
	Sequence,
	SessionId,
	TranscriptText,
	TrimmedNonEmptyString,
	TurnId
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_SESSION_MESSAGES_NAME = "projection.session-messages"

export const ProjectionSessionMessageRowType = Schema.Literals(["user", "assistant", "compaction"])
export type ProjectionSessionMessageRowType = typeof ProjectionSessionMessageRowType.Type

export const CompactionSeamStatus = Schema.Literals([
	"preparing",
	"completed",
	"usage_reset",
	"failed"
])
export type CompactionSeamStatus = typeof CompactionSeamStatus.Type

export const CompactionSeamTrigger = Schema.Literals(["auto", "manual", "unknown"])
export type CompactionSeamTrigger = typeof CompactionSeamTrigger.Type

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const TextContent = Schema.Struct({
	text: TranscriptText
})
export type TextContent = typeof TextContent.Type

export const CompactionSeamContent = Schema.Struct({
	status: CompactionSeamStatus,
	trigger: CompactionSeamTrigger,
	preCompactionTokens: Schema.NullOr(NonNegativeInt),
	postCompactionTokens: Schema.NullOr(NonNegativeInt),
	contextWindowSize: Schema.NullOr(NonNegativeInt),
	droppedTokens: Schema.NullOr(NonNegativeInt),
	summary: Schema.NullOr(Schema.String)
})
export type CompactionSeamContent = typeof CompactionSeamContent.Type

export const UserProjectedMessage = Schema.Struct({
	sessionId: SessionId,
	sequence: Sequence,
	messageId: TrimmedNonEmptyString,
	turnId: Schema.NullOr(TurnId),
	rowType: Schema.Literal("user"),
	content: TextContent
})
export type UserProjectedMessage = typeof UserProjectedMessage.Type

export const AssistantProjectedMessage = Schema.Struct({
	sessionId: SessionId,
	sequence: Sequence,
	messageId: TrimmedNonEmptyString,
	turnId: Schema.NullOr(TurnId),
	rowType: Schema.Literal("assistant"),
	content: TextContent
})
export type AssistantProjectedMessage = typeof AssistantProjectedMessage.Type

export const CompactionProjectedMessage = Schema.Struct({
	sessionId: SessionId,
	sequence: Sequence,
	messageId: TrimmedNonEmptyString,
	turnId: Schema.NullOr(TurnId),
	rowType: Schema.Literal("compaction"),
	content: CompactionSeamContent
})
export type CompactionProjectedMessage = typeof CompactionProjectedMessage.Type

export const ProjectionSessionMessage = Schema.Union([
	UserProjectedMessage,
	AssistantProjectedMessage,
	CompactionProjectedMessage
])
export type ProjectionSessionMessage = typeof ProjectionSessionMessage.Type

export const ProjectionSessionMessageStoredRow = Schema.Struct({
	session_id: SessionId,
	sequence: Sequence,
	message_id: TrimmedNonEmptyString,
	turn_id: Schema.NullOr(TurnId),
	row_type: ProjectionSessionMessageRowType,
	content: Schema.String,
	// The highest event sequence folded into this row (migration 0028). An
	// assistant row grows by appending TokenAppended tokens, so `sequence`
	// only names the first of them and cannot say whether a given event is
	// already in the text. NULL on every row written before the column
	// existed.
	last_sequence: Schema.NullOr(Sequence)
})
export type ProjectionSessionMessageStoredRow = typeof ProjectionSessionMessageStoredRow.Type

export const decodeProjectionSessionMessageStoredRows = Schema.decodeUnknownEffect(
	Schema.Array(ProjectionSessionMessageStoredRow)
)

const encodeTextContentJson = Schema.encodeEffect(Schema.fromJsonString(TextContent))
const encodeCompactionContentJson = Schema.encodeEffect(Schema.fromJsonString(CompactionSeamContent))
const decodeTextContentJson = Schema.decodeUnknownEffect(Schema.fromJsonString(TextContent))
const decodeCompactionContentJson = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompactionSeamContent)
)

export const userMessageRow = (input: {
	readonly sessionId: SessionId
	readonly sequence: Sequence
	readonly messageId: TrimmedNonEmptyString
	readonly turnId: TurnId | null
	readonly text: TranscriptText
}): UserProjectedMessage => ({
	sessionId: input.sessionId,
	sequence: input.sequence,
	messageId: input.messageId,
	turnId: input.turnId,
	rowType: "user",
	content: {
		text: input.text
	}
})

export const assistantMessageRow = (input: {
	readonly sessionId: SessionId
	readonly sequence: Sequence
	readonly messageId: TrimmedNonEmptyString
	readonly turnId: TurnId | null
	readonly text: TranscriptText
}): AssistantProjectedMessage => ({
	sessionId: input.sessionId,
	sequence: input.sequence,
	messageId: input.messageId,
	turnId: input.turnId,
	rowType: "assistant",
	content: {
		text: input.text
	}
})

export const compactionSeamRow = (input: {
	readonly sessionId: SessionId
	readonly sequence: Sequence
	readonly messageId: TrimmedNonEmptyString
	readonly turnId: TurnId | null
	readonly content: CompactionSeamContent
}): CompactionProjectedMessage => ({
	sessionId: input.sessionId,
	sequence: input.sequence,
	messageId: input.messageId,
	turnId: input.turnId,
	rowType: "compaction",
	content: {
		status: input.content.status,
		trigger: input.content.trigger,
		preCompactionTokens: input.content.preCompactionTokens,
		postCompactionTokens: input.content.postCompactionTokens,
		contextWindowSize: input.content.contextWindowSize,
		droppedTokens: input.content.droppedTokens,
		summary: input.content.summary
	}
})

const ignoreEvent = (): Option.Option<ProjectionSessionMessage> => Option.none()

export const rowFromEvent = (
	event: OrchestrationEvent
): Option.Option<ProjectionSessionMessage> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			MessageSent: (sent) =>
				Option.some(
					userMessageRow({
						sessionId: sent.payload.sessionId,
						sequence: sent.sequence,
						messageId: sent.payload.messageId,
						turnId: null,
						text: sent.payload.text
					})
				),
			TokenAppended: ignoreEvent,
			// Thought deltas are transcript-bearing on the LIVE path only (the
			// desktop bridge appends them as "thought" segments). The persisted
			// message projection has no thought row kind yet, so a reopened
			// session's snapshot does not carry thinking content.
			ThoughtAppended: ignoreEvent,
			ProjectCreated: ignoreEvent,
			ProjectMetaUpdated: ignoreEvent,
			ProjectDeleted: ignoreEvent,
			SessionCreated: ignoreEvent,
			SessionMetaUpdated: ignoreEvent,
			SessionArchived: ignoreEvent,
			SessionUnarchived: ignoreEvent,
			SessionDeleted: ignoreEvent,
			TurnCancelled: ignoreEvent,
			TurnCompleted: ignoreEvent,
			CheckpointCreated: ignoreEvent,
			CheckpointReadinessChanged: ignoreEvent,
			CheckpointReverted: ignoreEvent,
			CheckpointFileReverted: ignoreEvent,
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
			VoiceAmplitudeObserved: ignoreEvent,
			VoiceModelDownloadProgressed: ignoreEvent,
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
			ApprovalRequested: ignoreEvent,
			McpCatalogResolved: ignoreEvent,
			PreconnectionOptionsLoaded: ignoreEvent,
			TerminalOpened: ignoreEvent,
			TerminalOutputAppended: ignoreEvent,
			TerminalClosed: ignoreEvent,
			SessionReviewFileMarked: ignoreEvent,
			SessionReviewStateCleared: ignoreEvent,
			ProviderSessionFailed: ignoreEvent,
			TurnUsageObserved: ignoreEvent
		})
	)(event)

export const nextAssistantFromToken = Effect.fn("nextAssistantFromToken")(function*(
	event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>,
	current: Option.Option<ProjectionSessionMessage>
) {
	// TranscriptText, not TrimmedNonEmptyString: the row grows one token at a
	// time, so a trimming schema here ate the trailing space of the token
	// before it and glued the next one on ("I'll runall three steps.").
	// Decoded once, at the only seam where a token enters: text that already
	// holds a non-empty token stays non-empty however much is appended to it.
	const token = yield* Schema.decodeUnknownEffect(TranscriptText)(event.payload.token)
	if (Option.isSome(current) && current.value.rowType === "assistant") {
		return assistantMessageRow({
			sessionId: current.value.sessionId,
			sequence: current.value.sequence,
			messageId: current.value.messageId,
			turnId: current.value.turnId,
			text: `${current.value.content.text}${token}`
		})
	}
	return assistantMessageRow({
		sessionId: event.payload.sessionId,
		sequence: event.sequence,
		messageId: event.payload.messageId,
		turnId: null,
		text: token
	})
})

export const encodeContentJson = Effect.fn("encodeContentJson")(
	(message: ProjectionSessionMessage): Effect.Effect<string, Schema.SchemaError> =>
		Match.value(message).pipe(
			Match.discriminatorsExhaustive("rowType")({
				user: (row) => encodeTextContentJson(row.content),
				assistant: (row) => encodeTextContentJson(row.content),
				compaction: (row) => encodeCompactionContentJson(row.content)
			})
		)
)

export const decodeProjectedMessage = Effect.fn("decodeProjectedMessage")(
	(row: ProjectionSessionMessageStoredRow): Effect.Effect<ProjectionSessionMessage, Schema.SchemaError> =>
		Match.value(row.row_type).pipe(
			Match.when("user", () =>
				decodeTextContentJson(row.content).pipe(
					Effect.map((content): ProjectionSessionMessage => ({
						sessionId: row.session_id,
						sequence: row.sequence,
						messageId: row.message_id,
						turnId: row.turn_id,
						rowType: "user",
						content
					}))
				)
			),
			Match.when("assistant", () =>
				decodeTextContentJson(row.content).pipe(
					Effect.map((content): ProjectionSessionMessage => ({
						sessionId: row.session_id,
						sequence: row.sequence,
						messageId: row.message_id,
						turnId: row.turn_id,
						rowType: "assistant",
						content
					}))
				)
			),
			Match.when("compaction", () =>
				decodeCompactionContentJson(row.content).pipe(
					Effect.map((content): ProjectionSessionMessage => ({
						sessionId: row.session_id,
						sequence: row.sequence,
						messageId: row.message_id,
						turnId: row.turn_id,
						rowType: "compaction",
						content
					}))
				)
			),
			Match.exhaustive
		)
)

export class ProjectionSessionMessages extends Context.Service<
	ProjectionSessionMessages,
	{
		readonly apply: (
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) => Effect.Effect<void, SqlError | Schema.SchemaError>
		readonly truncate: (
			tx: SqlClient.SqlClient
		) => Effect.Effect<void, SqlError | Schema.SchemaError>
		readonly upsert: (
			row: ProjectionSessionMessage,
			tx: SqlClient.SqlClient
		) => Effect.Effect<void, SqlError | Schema.SchemaError>
		readonly listBySession: (
			sessionId: SessionId
		) => Effect.Effect<ReadonlyArray<ProjectionSessionMessage>, SqlError | Schema.SchemaError>
	}
>()("@acepe/server/persistence/Services/ProjectionSessionMessages") {}
