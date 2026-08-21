import {
	IsoDateTime,
	MessageSentPayload,
	type OrchestrationEvent,
	ProjectId,
	SessionArchivedPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionId,
	SessionMetaUpdatedPayload,
	SessionUnarchivedPayload,
	TokenAppendedPayload,
	TrimmedNonEmptyString,
	TurnCancelledPayload
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

const FALLBACK_SESSION_TITLES = HashSet.fromIterable([
	"New Thread",
	"New session",
	"New Session",
	"Loading..."
])

const GENERATED_SESSION_TITLE_PATTERN = /^Session [a-f0-9-]{6,}$/i
const XML_TAG_PATTERN =
	/<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>[\s\S]*?(?:<\/\1[^>]*>|(?=<[a-zA-Z])|$)/g
const ATTACHMENT_TOKEN_PATTERN = /@\[(file|image|image_ref|text|command|skill):[^\]]+\]?/g
const EXPANDED_ATTACHMENT_PATTERN = /\[Attached (?:image|file|PDF): [^\]]+\]/g

export const ProjectedSession = Schema.Struct({
	sessionId: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	provider: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	lastActivityAt: IsoDateTime,
	archivedAt: Schema.NullOr(IsoDateTime),
	deletedAt: Schema.NullOr(IsoDateTime)
})
export type ProjectedSession = typeof ProjectedSession.Type

const ProjectionSessionRow = Schema.Struct({
	session_id: SessionId,
	project_id: ProjectId,
	title: TrimmedNonEmptyString,
	provider: Schema.NullOr(TrimmedNonEmptyString),
	created_at: IsoDateTime,
	updated_at: IsoDateTime,
	last_activity_at: IsoDateTime,
	archived_at: Schema.NullOr(IsoDateTime),
	deleted_at: Schema.NullOr(IsoDateTime)
})

export interface ProjectionSessionsShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly list: () => Effect.Effect<
		ReadonlyArray<ProjectedSession>,
		SqlError | Schema.SchemaError
	>
	readonly get: (
		sessionId: SessionId
	) => Effect.Effect<Option.Option<ProjectedSession>, SqlError | Schema.SchemaError>
}

export class ProjectionSessions extends Context.Service<
	ProjectionSessions,
	ProjectionSessionsShape
>()("@acepe/server/persistence/Services/ProjectionSessions") {}

const projectedSessionFromRow = (
	row: typeof ProjectionSessionRow.Type
): ProjectedSession => ({
	sessionId: row.session_id,
	projectId: row.project_id,
	title: row.title,
	provider: row.provider,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	lastActivityAt: row.last_activity_at,
	archivedAt: row.archived_at,
	deletedAt: row.deleted_at
})

const decodeRow = Schema.decodeUnknownEffect(ProjectionSessionRow)

export const decodeStoredProjectedSession = Effect.fn("decodeStoredProjectedSession")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return projectedSessionFromRow(row)
	}
)

export const stripArtifactsFromTitle = (title: string): string => {
	let cleaned = title
	let previous = ""
	while (cleaned !== previous) {
		previous = cleaned
		XML_TAG_PATTERN.lastIndex = 0
		cleaned = cleaned.replace(XML_TAG_PATTERN, "")
	}
	ATTACHMENT_TOKEN_PATTERN.lastIndex = 0
	EXPANDED_ATTACHMENT_PATTERN.lastIndex = 0
	cleaned = cleaned.replace(ATTACHMENT_TOKEN_PATTERN, "").replace(EXPANDED_ATTACHMENT_PATTERN, "")
	return cleaned.trim()
}

export const isFallbackSessionTitle = (title: string): boolean => {
	const trimmedTitle = title.trim()
	return (
		HashSet.has(FALLBACK_SESSION_TITLES, trimmedTitle) ||
		GENERATED_SESSION_TITLE_PATTERN.test(trimmedTitle)
	)
}

export const deriveSessionTitleFromUserInput = (input: string): Option.Option<string> => {
	const trimmed = stripArtifactsFromTitle(input)
	if (trimmed.length === 0) {
		return Option.none()
	}
	if (trimmed.startsWith("/")) {
		return Option.none()
	}
	const firstLine = trimmed.split(/\r?\n/u)[0]
	if (firstLine === undefined) {
		return Option.none()
	}
	const first = firstLine.trim()
	if (first.length === 0) {
		return Option.none()
	}
	return Option.some(first)
}

export const getTitleUpdateFromUserMessage = (
	currentTitle: string,
	userMessage: string
): Option.Option<string> => {
	const strippedTitle = stripArtifactsFromTitle(currentTitle)
	const isArtifactOnlyTitle = strippedTitle.length === 0 && currentTitle.trim().length !== 0
	if (!isFallbackSessionTitle(currentTitle) && !isArtifactOnlyTitle) {
		return Option.none()
	}
	return deriveSessionTitleFromUserInput(userMessage)
}

const resolveStoredTitle = (raw: TrimmedNonEmptyString): TrimmedNonEmptyString => {
	const stripped = stripArtifactsFromTitle(raw)
	if (stripped.length === 0) {
		return raw
	}
	return stripped
}

const decodePayload = <S extends Schema.Top>(schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value)

const touch = (session: ProjectedSession, occurredAt: IsoDateTime): ProjectedSession => ({
	sessionId: session.sessionId,
	projectId: session.projectId,
	title: session.title,
	provider: session.provider,
	createdAt: session.createdAt,
	updatedAt: occurredAt,
	lastActivityAt: occurredAt,
	archivedAt: session.archivedAt,
	deletedAt: session.deletedAt
})

const projectSessionCreated = (
	event: Extract<OrchestrationEvent, { readonly type: "SessionCreated" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionCreatedPayload, event.payload).pipe(
		Effect.map((payload) =>
			Option.some({
				sessionId: payload.sessionId,
				projectId: payload.projectId,
				title: resolveStoredTitle(payload.title),
				provider: null,
				createdAt: event.occurredAt,
				updatedAt: event.occurredAt,
				lastActivityAt: event.occurredAt,
				archivedAt: null,
				deletedAt: null
			})
		)
	)

const mapExisting = (
	current: Option.Option<ProjectedSession>,
	update: (session: ProjectedSession) => ProjectedSession
): Option.Option<ProjectedSession> => Option.map(current, update)

const projectSessionMetaUpdated = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "SessionMetaUpdated" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionMetaUpdatedPayload, event.payload).pipe(
		Effect.map((payload) =>
			mapExisting(current, (session) => {
				const stamped = touch(session, event.occurredAt)
				if (payload.title === undefined) {
					return stamped
				}
				return {
					...stamped,
					title: resolveStoredTitle(payload.title)
				}
			})
		)
	)

const projectSessionArchived = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "SessionArchived" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionArchivedPayload, event.payload).pipe(
		Effect.map(() =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				archivedAt: event.occurredAt
			}))
		)
	)

const projectSessionUnarchived = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "SessionUnarchived" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionUnarchivedPayload, event.payload).pipe(
		Effect.map(() =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				archivedAt: null
			}))
		)
	)

const projectSessionDeleted = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "SessionDeleted" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionDeletedPayload, event.payload).pipe(
		Effect.map(() =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				deletedAt: event.occurredAt
			}))
		)
	)

const projectMessageSent = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "MessageSent" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(MessageSentPayload, event.payload).pipe(
		Effect.map((payload) =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				title: Option.getOrElse(
					getTitleUpdateFromUserMessage(session.title, payload.text),
					() => session.title
				)
			}))
		)
	)

const projectTokenAppended = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(TokenAppendedPayload, event.payload).pipe(
		Effect.map(() => mapExisting(current, (session) => touch(session, event.occurredAt)))
	)

const projectTurnCancelled = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "TurnCancelled" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(TurnCancelledPayload, event.payload).pipe(
		Effect.map(() => mapExisting(current, (session) => touch(session, event.occurredAt)))
	)

export const evolveProjectedSession = (
	current: Option.Option<ProjectedSession>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => Effect.succeed(current),
			ProjectMetaUpdated: () => Effect.succeed(current),
			ProjectDeleted: () => Effect.succeed(current),
			SessionCreated: (created) => projectSessionCreated(created),
			SessionMetaUpdated: (updated) => projectSessionMetaUpdated(current, updated),
			SessionArchived: (archived) => projectSessionArchived(current, archived),
			SessionUnarchived: (unarchived) => projectSessionUnarchived(current, unarchived),
			SessionDeleted: (deleted) => projectSessionDeleted(current, deleted),
			MessageSent: (sent) => projectMessageSent(current, sent),
			TokenAppended: (appended) => projectTokenAppended(current, appended),
			TurnCancelled: (cancelled) => projectTurnCancelled(current, cancelled),
			CheckpointCreated: () => Effect.succeed(current),
			CheckpointReadinessChanged: () => Effect.succeed(current),
			CheckpointReverted: () => Effect.succeed(current)
		})
	)(event)
