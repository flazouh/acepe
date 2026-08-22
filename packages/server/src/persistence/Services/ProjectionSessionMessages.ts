import {
	type OrchestrationEvent,
	Sequence,
	SessionId,
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
	text: TrimmedNonEmptyString
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
	content: Schema.String
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
	readonly text: TrimmedNonEmptyString
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
	readonly text: TrimmedNonEmptyString
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
			ProjectCreated: ignoreEvent,
			ProjectMetaUpdated: ignoreEvent,
			ProjectDeleted: ignoreEvent,
			SessionCreated: ignoreEvent,
			SessionMetaUpdated: ignoreEvent,
			SessionArchived: ignoreEvent,
			SessionUnarchived: ignoreEvent,
			SessionDeleted: ignoreEvent,
			TurnCancelled: ignoreEvent,
			CheckpointCreated: ignoreEvent,
			CheckpointReadinessChanged: ignoreEvent,
			CheckpointReverted: ignoreEvent,
			SettingsUpdated: ignoreEvent,
			SkillsDiscovered: ignoreEvent
		})
	)(event)

export const nextAssistantFromToken = Effect.fn("nextAssistantFromToken")(function*(
	event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>,
	current: Option.Option<ProjectionSessionMessage>
) {
	if (Option.isSome(current) && current.value.rowType === "assistant") {
		const text = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)(
			`${current.value.content.text}${event.payload.token}`
		)
		return assistantMessageRow({
			sessionId: current.value.sessionId,
			sequence: current.value.sequence,
			messageId: current.value.messageId,
			turnId: current.value.turnId,
			text
		})
	}
	const text = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)(event.payload.token)
	return assistantMessageRow({
		sessionId: event.payload.sessionId,
		sequence: event.sequence,
		messageId: event.payload.messageId,
		turnId: null,
		text
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
