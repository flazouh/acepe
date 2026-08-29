import {
	decodeTurnId,
	IsoDateTime,
	MessageSentPayload,
	type OrchestrationEvent,
	ProviderSessionFailedPayload,
	Sequence,
	SessionId,
	TokenAppendedPayload,
	TrimmedNonEmptyString,
	TurnCancelledPayload,
	TurnCompletedPayload,
	TurnId,
	TurnUsageObservedPayload
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_TURNS_NAME = "projection.turns"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

export const TurnStatus = Schema.Literals(["running", "completed", "cancelled"])
export type TurnStatus = typeof TurnStatus.Type

export const ProjectedTurn = Schema.Struct({
	turnId: TurnId,
	sessionId: SessionId,
	sequence: Sequence,
	status: TurnStatus,
	startedAt: IsoDateTime,
	endedAt: Schema.NullOr(IsoDateTime),
	cancelledAt: Schema.NullOr(IsoDateTime),
	inputTokens: NonNegativeInt,
	outputTokens: NonNegativeInt,
	cacheReadTokens: NonNegativeInt,
	cacheWriteTokens: NonNegativeInt,
	costUsd: NonNegativeNumber,
	// AC-269: a point-in-time snapshot (the provider's own reported context
	// window occupancy), not additive across turns -- unlike the token/cost
	// columns above, deliberately left out of ProjectedSessionUsage's SUM.
	contextWindowSize: Schema.NullOr(NonNegativeInt)
})
export type ProjectedTurn = typeof ProjectedTurn.Type

export const ProjectedSessionUsage = Schema.Struct({
	sessionId: SessionId,
	inputTokens: NonNegativeInt,
	outputTokens: NonNegativeInt,
	cacheReadTokens: NonNegativeInt,
	cacheWriteTokens: NonNegativeInt,
	costUsd: NonNegativeNumber
})
export type ProjectedSessionUsage = typeof ProjectedSessionUsage.Type

const ProjectionTurnRow = Schema.Struct({
	turn_id: TurnId,
	session_id: SessionId,
	sequence: Sequence,
	status: TurnStatus,
	started_at: IsoDateTime,
	ended_at: Schema.NullOr(IsoDateTime),
	cancelled_at: Schema.NullOr(IsoDateTime),
	input_tokens: NonNegativeInt,
	output_tokens: NonNegativeInt,
	cache_read_tokens: NonNegativeInt,
	cache_write_tokens: NonNegativeInt,
	cost_usd: NonNegativeNumber,
	context_window_size: Schema.NullOr(NonNegativeInt)
})

const SessionUsageRow = Schema.Struct({
	input_tokens: NonNegativeNumber,
	output_tokens: NonNegativeNumber,
	cache_read_tokens: NonNegativeNumber,
	cache_write_tokens: NonNegativeNumber,
	cost_usd: NonNegativeNumber
})

export interface ProjectionTurnsShape {
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
	) => Effect.Effect<ReadonlyArray<ProjectedTurn>, SqlError | Schema.SchemaError>
	readonly get: (
		turnId: TurnId
	) => Effect.Effect<Option.Option<ProjectedTurn>, SqlError | Schema.SchemaError>
	readonly sessionTotals: (
		sessionId: SessionId
	) => Effect.Effect<ProjectedSessionUsage, SqlError | Schema.SchemaError>
}

export class ProjectionTurns extends Context.Service<
	ProjectionTurns,
	ProjectionTurnsShape
>()("@acepe/server/persistence/Services/ProjectionTurns") {}

const projectedTurnFromRow = (row: typeof ProjectionTurnRow.Type): ProjectedTurn => ({
	turnId: row.turn_id,
	sessionId: row.session_id,
	sequence: row.sequence,
	status: row.status,
	startedAt: row.started_at,
	endedAt: row.ended_at,
	cancelledAt: row.cancelled_at,
	inputTokens: row.input_tokens,
	outputTokens: row.output_tokens,
	cacheReadTokens: row.cache_read_tokens,
	cacheWriteTokens: row.cache_write_tokens,
	costUsd: row.cost_usd,
	contextWindowSize: row.context_window_size
})

const decodeRow = Schema.decodeUnknownEffect(ProjectionTurnRow)
const decodeUsageRow = Schema.decodeUnknownEffect(SessionUsageRow)
const decodeNonNegativeInt = Schema.decodeUnknownEffect(NonNegativeInt)

export const decodeStoredProjectedTurn = Effect.fn("decodeStoredProjectedTurn")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return projectedTurnFromRow(row)
	}
)

export const decodeStoredSessionUsage = Effect.fn("decodeStoredSessionUsage")(function*(
	sessionId: SessionId,
	input: unknown
) {
	const row = yield* decodeUsageRow(input)
	return {
		sessionId,
		inputTokens: yield* decodeNonNegativeInt(row.input_tokens),
		outputTokens: yield* decodeNonNegativeInt(row.output_tokens),
		cacheReadTokens: yield* decodeNonNegativeInt(row.cache_read_tokens),
		cacheWriteTokens: yield* decodeNonNegativeInt(row.cache_write_tokens),
		costUsd: row.cost_usd
	}
})

const decodePayload = <S extends Schema.Top>(schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value)

export const isOpenTurn = (turn: ProjectedTurn): boolean =>
	turn.status === "running" && turn.endedAt === null

const findOpenTurn = (turns: ReadonlyArray<ProjectedTurn>): Option.Option<ProjectedTurn> =>
	Arr.last(Arr.filter(turns, isOpenTurn))

const sessionOf = (turns: ReadonlyArray<ProjectedTurn>): Option.Option<SessionId> =>
	Option.map(Arr.head(turns), (turn) => turn.sessionId)

const forThisSession = (turns: ReadonlyArray<ProjectedTurn>, sessionId: SessionId): boolean =>
	Option.match(sessionOf(turns), {
		onNone: () => true,
		onSome: (currentSessionId) => currentSessionId === sessionId
	})

const hasTurnId = (turns: ReadonlyArray<ProjectedTurn>, turnId: TurnId): boolean =>
	Option.isSome(Arr.findFirst(turns, (turn) => turn.turnId === turnId))

const replaceTurn = (
	turns: ReadonlyArray<ProjectedTurn>,
	next: ProjectedTurn
): ReadonlyArray<ProjectedTurn> => {
	if (hasTurnId(turns, next.turnId)) {
		return Arr.map(turns, (turn) => (turn.turnId === next.turnId ? next : turn))
	}
	return Arr.append(turns, next)
}

const startTurn = (input: {
	readonly turnId: TurnId
	readonly sessionId: SessionId
	readonly sequence: Sequence
	readonly startedAt: IsoDateTime
	readonly outputTokens: number
}): ProjectedTurn => ({
	turnId: input.turnId,
	sessionId: input.sessionId,
	sequence: input.sequence,
	status: "running",
	startedAt: input.startedAt,
	endedAt: null,
	cancelledAt: null,
	inputTokens: 0,
	outputTokens: input.outputTokens,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	costUsd: 0,
	contextWindowSize: null
})

const completeTurn = (turn: ProjectedTurn, endedAt: IsoDateTime): ProjectedTurn => ({
	...turn,
	status: "completed",
	endedAt
})

const cancelTurn = (turn: ProjectedTurn, at: IsoDateTime): ProjectedTurn => ({
	...turn,
	status: "cancelled",
	endedAt: at,
	cancelledAt: at
})

const addOutputToken = (turn: ProjectedTurn): ProjectedTurn => ({
	...turn,
	outputTokens: turn.outputTokens + 1
})

const closeOpenTurns = (
	turns: ReadonlyArray<ProjectedTurn>,
	endedAt: IsoDateTime
): ReadonlyArray<ProjectedTurn> =>
	Arr.map(turns, (turn) => (isOpenTurn(turn) ? completeTurn(turn, endedAt) : turn))

// A turn is "running" while a provider is working on it. An imported turn
// never is: the history importer replays a transcript the provider finished
// before Acepe read the file, and nothing will ever close it from outside --
// ProviderBridge deliberately does not answer an imported prompt. So an
// imported message opens and ends its turn in one step, and the imported
// assistant text that follows counts against that turn rather than opening
// one of its own.
const importedTurn = (input: {
	readonly turnId: TurnId
	readonly sessionId: SessionId
	readonly sequence: Sequence
	readonly at: IsoDateTime
	readonly outputTokens: number
}): ProjectedTurn =>
	completeTurn(
		startTurn({
			turnId: input.turnId,
			sessionId: input.sessionId,
			sequence: input.sequence,
			startedAt: input.at,
			outputTokens: input.outputTokens
		}),
		input.at
	)

const projectMessageSent = (
	current: ReadonlyArray<ProjectedTurn>,
	event: Extract<OrchestrationEvent, { readonly type: "MessageSent" }>
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	decodePayload(MessageSentPayload, event.payload).pipe(
		Effect.flatMap((payload) => {
			if (!forThisSession(current, payload.sessionId)) {
				return Effect.succeed(current)
			}
			return decodeTurnId(payload.messageId).pipe(
				Effect.map((turnId) => {
					if (hasTurnId(current, turnId)) {
						return current
					}
					const closed = closeOpenTurns(current, event.occurredAt)
					if (payload.origin === "imported") {
						return Arr.append(
							closed,
							importedTurn({
								turnId,
								sessionId: payload.sessionId,
								sequence: event.sequence,
								at: event.occurredAt,
								outputTokens: 0
							})
						)
					}
					return Arr.append(
						closed,
						startTurn({
							turnId,
							sessionId: payload.sessionId,
							sequence: event.sequence,
							startedAt: event.occurredAt,
							outputTokens: 0
						})
					)
				})
			)
		})
	)

const projectTokenAppended = (
	current: ReadonlyArray<ProjectedTurn>,
	event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	decodePayload(TokenAppendedPayload, event.payload).pipe(
		Effect.flatMap((payload) => {
			if (!forThisSession(current, payload.sessionId)) {
				return Effect.succeed(current)
			}
			const open = findOpenTurn(current)
			if (Option.isSome(open)) {
				return Effect.succeed(replaceTurn(current, addOutputToken(open.value)))
			}
			// Imported assistant text belongs to the imported turn just
			// above it, which is already finished (see importedTurn). Its
			// own message id is the provider's assistant id, not a turn id
			// anything else refers to, so starting a turn from it would
			// double every imported turn and leave the new one running.
			if (payload.origin === "imported") {
				const last = Arr.last(current)
				if (Option.isSome(last)) {
					return Effect.succeed(replaceTurn(current, addOutputToken(last.value)))
				}
			}
			return decodeTurnId(payload.messageId).pipe(
				Effect.map((turnId) =>
					payload.origin === "imported"
						? Arr.append(
							current,
							importedTurn({
								turnId,
								sessionId: payload.sessionId,
								sequence: event.sequence,
								at: event.occurredAt,
								outputTokens: 1
							})
						)
						: Arr.append(
							current,
							startTurn({
								turnId,
								sessionId: payload.sessionId,
								sequence: event.sequence,
								startedAt: event.occurredAt,
								outputTokens: 1
							})
						)
				)
			)
		})
	)

const projectTurnCancelled = (
	current: ReadonlyArray<ProjectedTurn>,
	event: Extract<OrchestrationEvent, { readonly type: "TurnCancelled" }>
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	decodePayload(TurnCancelledPayload, event.payload).pipe(
		Effect.map((payload) => {
			if (!forThisSession(current, payload.sessionId)) {
				return current
			}
			const target =
				payload.turnId !== undefined
					? Arr.findFirst(
							current,
							(turn) => turn.turnId === payload.turnId && isOpenTurn(turn)
						)
					: findOpenTurn(current)
			return Option.match(target, {
				onNone: () => current,
				onSome: (turn) => replaceTurn(current, cancelTurn(turn, event.occurredAt))
			})
		})
	)

// A provider adapter's own turn-end signal (Claude's `result` message,
// Codex's TaskComplete, OpenCode's session-idle) is the only thing that
// closes a turn absent a follow-up MessageSent or an explicit cancellation.
// Without this, projection_turns.status is stuck on "running" forever for
// any session that never sends a second message.
const projectTurnCompleted = (
	current: ReadonlyArray<ProjectedTurn>,
	event: Extract<OrchestrationEvent, { readonly type: "TurnCompleted" }>
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	decodePayload(TurnCompletedPayload, event.payload).pipe(
		Effect.map((payload) => {
			if (!forThisSession(current, payload.sessionId)) {
				return current
			}
			const target =
				payload.turnId !== undefined
					? Arr.findFirst(
							current,
							(turn) => turn.turnId === payload.turnId && isOpenTurn(turn)
						)
					: findOpenTurn(current)
			return Option.match(target, {
				onNone: () => current,
				onSome: (turn) => replaceTurn(current, completeTurn(turn, event.occurredAt))
			})
		})
	)

// AC-270: a provider adapter's stream can die BEFORE the SDK ever produces
// its own turn-end signal — a spawn failure, a decode failure, a transport
// death (see Claude/Adapter.ts's attachQuery, whose listener fiber can fail
// the whole Stream.runForEach on exactly this). ProviderBridge already turns
// that into a typed ProviderSessionFailed event instead of leaving the
// session silently stalled (see its own payload doc), but until this fix
// nothing here ever consumed it: projection_turns.status stayed "running"
// forever, so the composer stayed on "Interrupt" and the transcript stayed on
// a working placeholder with no way out — the exact "I sent a message and
// nothing happens" symptom. Closes the open turn the same way TurnCompleted
// does (as "completed" — projection_turns has no separate "failed" status
// yet, matching the same call Session.ts's turn_error handling already made).
const projectProviderSessionFailed = (
	current: ReadonlyArray<ProjectedTurn>,
	event: Extract<OrchestrationEvent, { readonly type: "ProviderSessionFailed" }>
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	decodePayload(ProviderSessionFailedPayload, event.payload).pipe(
		Effect.map((payload) => {
			if (!forThisSession(current, payload.sessionId)) {
				return current
			}
			const open = findOpenTurn(current)
			return Option.match(open, {
				onNone: () => current,
				onSome: (turn) => replaceTurn(current, completeTurn(turn, event.occurredAt))
			})
		})
	)

// AC-269: a real provider usage reading always overwrites the field(s) it
// carries -- unlike TokenAppended's addOutputToken, which only ever counts
// streaming events as a rough proxy, this is the provider's own authoritative
// number. A field the payload omits (Schema.optionalKey) keeps the turn's
// prior reading rather than resetting it, so a later usage event that only
// reports e.g. outputTokens does not blank out a previously-seen cost.
const applyUsageToTurn = (
	turn: ProjectedTurn,
	payload: typeof TurnUsageObservedPayload.Type
): ProjectedTurn => ({
	...turn,
	inputTokens: payload.inputTokens ?? turn.inputTokens,
	outputTokens: payload.outputTokens ?? turn.outputTokens,
	cacheReadTokens: payload.cacheReadTokens ?? turn.cacheReadTokens,
	cacheWriteTokens: payload.cacheWriteTokens ?? turn.cacheWriteTokens,
	costUsd: payload.costUsd ?? turn.costUsd,
	contextWindowSize: payload.contextWindowSize ?? turn.contextWindowSize
})

// Mirrors projectTurnCompleted/projectTurnCancelled's own targeting: prefer
// the named turn (if the adapter could resolve one and it's still open),
// otherwise fall back to whichever turn is currently open for the session. A
// reading that names no open turn (already completed, or no turn at all) is
// dropped rather than silently starting/reopening one -- usage never mints a
// turn on its own, exactly like TurnCancelled/TurnCompleted.
const projectTurnUsageObserved = (
	current: ReadonlyArray<ProjectedTurn>,
	event: Extract<OrchestrationEvent, { readonly type: "TurnUsageObserved" }>
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	decodePayload(TurnUsageObservedPayload, event.payload).pipe(
		Effect.map((payload) => {
			if (!forThisSession(current, payload.sessionId)) {
				return current
			}
			const target =
				payload.turnId !== undefined
					? Arr.findFirst(
							current,
							(turn) => turn.turnId === payload.turnId && isOpenTurn(turn)
						)
					: findOpenTurn(current)
			return Option.match(target, {
				onNone: () => current,
				onSome: (turn) => replaceTurn(current, applyUsageToTurn(turn, payload))
			})
		})
	)

export const evolveProjectedTurns = (
	current: ReadonlyArray<ProjectedTurn>,
	event: OrchestrationEvent
): Effect.Effect<ReadonlyArray<ProjectedTurn>, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => Effect.succeed(current),
			ProjectMetaUpdated: () => Effect.succeed(current),
			ProjectDeleted: () => Effect.succeed(current),
			SessionCreated: () => Effect.succeed(current),
			SessionMetaUpdated: () => Effect.succeed(current),
			SessionArchived: () => Effect.succeed(current),
			SessionUnarchived: () => Effect.succeed(current),
			SessionDeleted: () => Effect.succeed(current),
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
			ProviderSessionFailed: (failed) => projectProviderSessionFailed(current, failed),
			TurnUsageObserved: (observed) => projectTurnUsageObserved(current, observed)
		})
	)(event)
