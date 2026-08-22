import {
	decodeTurnId,
	IsoDateTime,
	MessageSentPayload,
	type OrchestrationEvent,
	Sequence,
	SessionId,
	TokenAppendedPayload,
	TrimmedNonEmptyString,
	TurnCancelledPayload,
	TurnId
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
	costUsd: NonNegativeNumber
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
	cost_usd: NonNegativeNumber
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
	costUsd: row.cost_usd
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
	costUsd: 0
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
					return Arr.append(
						closeOpenTurns(current, event.occurredAt),
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
			return decodeTurnId(payload.messageId).pipe(
				Effect.map((turnId) =>
					Arr.append(
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
			CheckpointCreated: () => Effect.succeed(current),
			CheckpointReadinessChanged: () => Effect.succeed(current),
			CheckpointReverted: () => Effect.succeed(current),
			SettingsUpdated: () => Effect.succeed(current)
		})
	)(event)
