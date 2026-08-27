import {
	IsoDateTime,
	type JsonObject,
	MessageSentPayload,
	type OrchestrationEvent,
	ProjectId,
	ProviderSessionFailedPayload,
	SessionArchivedPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionId,
	SessionMetaUpdatedPayload,
	SessionModelCatalog,
	SessionModelSetPayload,
	SessionModelsListedFact,
	SessionModeSetPayload,
	SessionPrLinkMode,
	SessionPrNumber,
	SessionUnarchivedPayload,
	StoredSessionModelCatalog,
	TokenAppendedPayload,
	TrimmedNonEmptyString,
	TurnCancelledPayload,
	TurnCompletedPayload
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
	deletedAt: Schema.NullOr(IsoDateTime),
	prNumber: SessionPrNumber.pipe(Schema.NullOr),
	prLinkMode: SessionPrLinkMode.pipe(Schema.NullOr),
	// The provider's own session identity (e.g. a Claude Code JSONL uuid),
	// learned from the provider_session contract fact a real-provider adapter
	// encodes onto a generic SessionMetaUpdated event's metadata (see
	// Claude/Map.ts's promotionFacts / encodeContractFact). Every
	// real-provider session has TWO permanent ids: this one (keys the
	// on-disk provider history) and sessionId above (keys every orchestration
	// event/projection). Null until the provider's first durable message
	// promotes its session id, and forever null for a session the tracer
	// owns (no real provider attached).
	providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
	// True once a ProviderSessionFailed event has fired for this session and
	// it never got a providerSessionId (see providerSessionIdFromMetadata):
	// the adapter died before the provider ever wrote anything to disk, so
	// there is no on-disk history a "ghost row" could ever resolve to. A
	// session that failed AFTER learning its providerSessionId is not a
	// ghost -- its disk-scanned row is still real and openable, and this
	// flag intentionally stays false for that case (see evolveProjectedSession).
	providerSessionFailed: Schema.Boolean,
	// The mode this session runs in, read off the canonical SessionModeSet
	// event (issue #272). This is the ONLY source of truth for the current
	// mode: a provider reports its own opening mode at every (re)open --
	// OpenCode hardcodes OPENCODE_DEFAULT_MODE in Adapter.ts's startSession --
	// so a session reopened with a recorded plan mode runs plan while the
	// provider still reports build.
	//
	// Precedence, deliberate and permanent: a SessionModeSet always wins over
	// the provider's opening value. Null means no SessionModeSet ever fired
	// for this session, and only then does the provider's opening mode stand.
	// availableModes stays provider-owned -- only the provider knows which
	// modes exist -- so this pairs a canonical current mode with a provider
	// catalog, never two answers to the same question.
	//
	// Optional like ProjectedSessionActivity.output: a row written before the
	// current_mode_id column existed reads back with no value at all.
	currentModeId: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	// The model this session runs, read off the canonical SessionModelSet
	// event. Same precedence rule as currentModeId above and the same reason
	// for it: a provider starts a fresh adapter session on whatever its own
	// configuration selects, so a model chosen before a reopen would revert.
	//
	// Null means no SessionModelSet ever fired, and the provider's own default
	// stands. Optional for a row written before the column existed.
	currentModelId: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	// The models this session's provider reports it can run, published by the
	// adapter as a session_models fact (see SessionModelsListedFact). This is
	// the ONLY source of models for the picker: the hand-written constant it
	// used to read could not know about a model the provider shipped later.
	//
	// Null, not an empty list, for a session whose provider was never asked or
	// could not answer. A provider with no catalog publishes none and the
	// picker honestly offers nothing -- there is no constant to fall back to.
	availableModels: SessionModelCatalog.pipe(Schema.NullOr, Schema.optionalKey)
})
export type ProjectedSession = typeof ProjectedSession.Type

const SqliteFlag = Schema.Literals([0, 1])

const ProjectionSessionRow = Schema.Struct({
	session_id: SessionId,
	project_id: ProjectId,
	title: TrimmedNonEmptyString,
	provider: Schema.NullOr(TrimmedNonEmptyString),
	created_at: IsoDateTime,
	updated_at: IsoDateTime,
	last_activity_at: IsoDateTime,
	archived_at: Schema.NullOr(IsoDateTime),
	deleted_at: Schema.NullOr(IsoDateTime),
	pr_number: SessionPrNumber.pipe(Schema.NullOr),
	pr_link_mode: SessionPrLinkMode.pipe(Schema.NullOr),
	provider_session_id: Schema.NullOr(TrimmedNonEmptyString),
	provider_session_failed: SqliteFlag,
	current_mode_id: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	current_model_id: TrimmedNonEmptyString.pipe(Schema.NullOr, Schema.optionalKey),
	// JSON text through the same schema that wrote it, the way
	// ProjectedSessionActivity stores its input and output payloads.
	available_models: StoredSessionModelCatalog.pipe(Schema.optionalKey)
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
	readonly listForProject: (
		projectId: ProjectId
	) => Effect.Effect<ReadonlyArray<ProjectedSession>, SqlError | Schema.SchemaError>
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
	deletedAt: row.deleted_at,
	prNumber: row.pr_number,
	prLinkMode: row.pr_link_mode,
	providerSessionId: row.provider_session_id,
	providerSessionFailed: row.provider_session_failed === 1,
	currentModeId: row.current_mode_id ?? null,
	currentModelId: row.current_model_id ?? null,
	availableModels: row.available_models ?? null
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

// Every real-provider adapter (Claude/Codec.ts, Codex/Codec.ts,
// Cursor/Codec.ts, Copilot/Codec.ts, OpenCode/Codec.ts) encodes an unhandled
// provider_session contract fact the same way onto a generic
// SessionMetaUpdated event's metadata: { type: "provider_session",
// providerSessionId }. This decoder is intentionally provider-agnostic --
// the projection layer must not know which real provider produced the fact,
// only that the shape matches.
const ProviderSessionFactMetadata = Schema.Struct({
	// The adapters' encodeContractFact writes the discriminator as
	// `contractKind` (live-verified event metadata:
	// {"contractKind":"provider_session","providerSessionId":"<uuid>"}).
	contractKind: Schema.Literal("provider_session"),
	providerSessionId: TrimmedNonEmptyString
})

const providerSessionIdFromMetadata = (
	metadata: JsonObject
): (typeof TrimmedNonEmptyString.Type) | null => {
	const decoded = Schema.decodeUnknownOption(ProviderSessionFactMetadata)(metadata)
	return Option.match(decoded, {
		onNone: () => null,
		onSome: (fact) => fact.providerSessionId
	})
}

// The catalog rides the same SessionMetaUpdated metadata channel as
// provider_session above, so most meta updates carry none: a null answer here
// means "this event said nothing about models", never "this session has no
// models". Erasing a projected catalog on every title change would empty the
// picker mid-session.
const sessionModelsFromMetadata = (metadata: JsonObject): SessionModelCatalog | null => {
	const decoded = Schema.decodeUnknownOption(SessionModelsListedFact)(metadata)
	return Option.match(decoded, {
		onNone: () => null,
		onSome: (fact) => fact.models
	})
}

// A row stored before the current_mode_id column existed decodes with the key
// absent; every reader wants the same "no canonical mode yet" answer for that
// and for an explicit null, so normalize once here.
const currentModeIdOf = (
	session: ProjectedSession
): (typeof TrimmedNonEmptyString.Type) | null => session.currentModeId ?? null

const currentModelIdOf = (
	session: ProjectedSession
): (typeof TrimmedNonEmptyString.Type) | null => session.currentModelId ?? null

const availableModelsOf = (
	session: ProjectedSession
): SessionModelCatalog | null => session.availableModels ?? null

const touch = (session: ProjectedSession, occurredAt: IsoDateTime): ProjectedSession => ({
	sessionId: session.sessionId,
	projectId: session.projectId,
	title: session.title,
	provider: session.provider,
	createdAt: session.createdAt,
	updatedAt: occurredAt,
	lastActivityAt: occurredAt,
	archivedAt: session.archivedAt,
	deletedAt: session.deletedAt,
	prNumber: session.prNumber,
	prLinkMode: session.prLinkMode,
	providerSessionId: session.providerSessionId,
	providerSessionFailed: session.providerSessionFailed,
	currentModeId: currentModeIdOf(session),
	currentModelId: currentModelIdOf(session),
	availableModels: availableModelsOf(session)
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
				provider: payload.providerId ?? null,
				createdAt: event.occurredAt,
				updatedAt: event.occurredAt,
				lastActivityAt: event.occurredAt,
				archivedAt: null,
				deletedAt: null,
				prNumber: null,
				prLinkMode: null,
				providerSessionId: null,
				providerSessionFailed: false,
				currentModeId: null,
				currentModelId: null,
				availableModels: null
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
				const providerSessionId = providerSessionIdFromMetadata(event.metadata)
				const publishedModels = sessionModelsFromMetadata(event.metadata)
				return {
					sessionId: stamped.sessionId,
					projectId: stamped.projectId,
					title:
						payload.title !== undefined ? resolveStoredTitle(payload.title) : stamped.title,
					provider: stamped.provider,
					createdAt: stamped.createdAt,
					updatedAt: stamped.updatedAt,
					lastActivityAt: stamped.lastActivityAt,
					archivedAt: stamped.archivedAt,
					deletedAt: stamped.deletedAt,
					prNumber:
						payload.prNumber !== undefined ? payload.prNumber : stamped.prNumber,
					prLinkMode:
						payload.prLinkMode !== undefined ? payload.prLinkMode : stamped.prLinkMode,
					providerSessionId: providerSessionId !== null ? providerSessionId : stamped.providerSessionId,
					providerSessionFailed: stamped.providerSessionFailed,
					currentModeId: currentModeIdOf(stamped),
					currentModelId: currentModelIdOf(stamped),
					availableModels: publishedModels !== null
						? publishedModels
						: availableModelsOf(stamped)
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

const projectTurnCompleted = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "TurnCompleted" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(TurnCompletedPayload, event.payload).pipe(
		Effect.map(() => mapExisting(current, (session) => touch(session, event.occurredAt)))
	)

// The canonical mode fact, folded so the LAST SessionModeSet wins: replaying
// a session that changed mode three times lands on the third. Nothing else
// writes currentModeId, so a provider's opening mode can never overwrite a
// choice the user already made -- see currentModeId on ProjectedSession.
const projectSessionModeSet = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "SessionModeSet" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionModeSetPayload, event.payload).pipe(
		Effect.map((payload) =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				currentModeId: payload.modeId
			}))
		)
	)

// The canonical model fact, folded exactly like projectSessionModeSet above so
// the LAST SessionModelSet wins. Until this existed the event was committed and
// read by nothing, so a chosen model survived neither a reopen nor a restart.
const projectSessionModelSet = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "SessionModelSet" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(SessionModelSetPayload, event.payload).pipe(
		Effect.map((payload) =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				currentModelId: payload.modelId
			}))
		)
	)

// A session that fails before ever learning its providerSessionId (no
// on-disk history to fall back to) is a "ghost row": it sits in the
// library listing forever, unopenable. Marking it here lets the desktop
// merge (mergeProjectionSessions) exclude it instead of pushing a dead
// row -- see providerSessionFailed's doc on ProjectedSession.
const projectProviderSessionFailed = (
	current: Option.Option<ProjectedSession>,
	event: Extract<OrchestrationEvent, { readonly type: "ProviderSessionFailed" }>
): Effect.Effect<Option.Option<ProjectedSession>, Schema.SchemaError> =>
	decodePayload(ProviderSessionFailedPayload, event.payload).pipe(
		Effect.map(() =>
			mapExisting(current, (session) => ({
				...touch(session, event.occurredAt),
				providerSessionFailed: true
			}))
		)
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
			TurnCompleted: (completed) => projectTurnCompleted(current, completed),
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
			GitStatusRefreshed: () => Effect.succeed(current),
			GitDiffLoaded: () => Effect.succeed(current),
			GitBlameLoaded: () => Effect.succeed(current),
			GitHunkAccepted: () => Effect.succeed(current),
			GitHunkRejected: () => Effect.succeed(current),
			SessionResumed: () => Effect.succeed(current),
			SessionForked: () => Effect.succeed(current),
			SessionClosed: () => Effect.succeed(current),
			SessionModelSet: (modelSet) => projectSessionModelSet(current, modelSet),
			SessionModeSet: (modeSet) => projectSessionModeSet(current, modeSet),
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
			ProviderSessionFailed: (failed) => projectProviderSessionFailed(current, failed),
			TurnUsageObserved: () => Effect.succeed(current)
		})
	)(event)
