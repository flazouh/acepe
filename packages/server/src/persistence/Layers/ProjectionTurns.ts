import {
	type OrchestrationEvent,
	SessionId,
	TrimmedNonEmptyString,
	TurnId
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedTurn,
	decodeStoredSessionUsage,
	evolveProjectedTurns,
	type ProjectedTurn,
	PROJECTION_TURNS_NAME,
	ProjectionTurns
} from "../Services/ProjectionTurns.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readByTurnId = Effect.fn("ProjectionTurns.readByTurnId")(function*(
	tx: SqlClient.SqlClient,
	turnId: TurnId
) {
	const rows = yield* tx`
		SELECT
			turn_id,
			session_id,
			sequence,
			status,
			started_at,
			ended_at,
			cancelled_at,
			input_tokens,
			output_tokens,
			cache_read_tokens,
			cache_write_tokens,
			cost_usd
		FROM projection_turns
		WHERE turn_id = ${turnId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedTurn(row).pipe(Effect.map(Option.some))
	})
})

const readBySession = Effect.fn("ProjectionTurns.readBySession")(function*(
	tx: SqlClient.SqlClient,
	sessionId: SessionId
) {
	const rows = yield* tx`
		SELECT
			turn_id,
			session_id,
			sequence,
			status,
			started_at,
			ended_at,
			cancelled_at,
			input_tokens,
			output_tokens,
			cache_read_tokens,
			cache_write_tokens,
			cost_usd
		FROM projection_turns
		WHERE session_id = ${sessionId}
		ORDER BY sequence ASC, turn_id ASC
	`.withoutTransform
	return yield* Effect.forEach(rows, decodeStoredProjectedTurn)
})

const upsert = Effect.fn("ProjectionTurns.upsert")(function*(
	tx: SqlClient.SqlClient,
	turn: ProjectedTurn
) {
	yield* tx`
		INSERT INTO projection_turns (
			turn_id,
			session_id,
			sequence,
			status,
			started_at,
			ended_at,
			cancelled_at,
			input_tokens,
			output_tokens,
			cache_read_tokens,
			cache_write_tokens,
			cost_usd
		) VALUES (
			${turn.turnId},
			${turn.sessionId},
			${turn.sequence},
			${turn.status},
			${turn.startedAt},
			${turn.endedAt},
			${turn.cancelledAt},
			${turn.inputTokens},
			${turn.outputTokens},
			${turn.cacheReadTokens},
			${turn.cacheWriteTokens},
			${turn.costUsd}
		)
		ON CONFLICT(turn_id) DO UPDATE SET
			session_id = excluded.session_id,
			sequence = excluded.sequence,
			status = excluded.status,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at,
			cancelled_at = excluded.cancelled_at,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_read_tokens = excluded.cache_read_tokens,
			cache_write_tokens = excluded.cache_write_tokens,
			cost_usd = excluded.cost_usd
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionTurnsLive = Layer.effect(ProjectionTurns)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_TURNS_NAME)

		const apply = Effect.fn("ProjectionTurns.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			if (event.aggregateKind !== "session") {
				return
			}
			const current = yield* readBySession(tx, event.aggregateId)
			const next = yield* evolveProjectedTurns(current, event)
			yield* Effect.forEach(next, (turn) => upsert(tx, turn), { discard: true })
		})

		const truncate = Effect.fn("ProjectionTurns.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_turns`.withoutTransform.pipe(Effect.asVoid)
		})

		const listBySession = Effect.fn("ProjectionTurns.listBySession")(function*(
			sessionId: SessionId
		) {
			return yield* readBySession(sql, sessionId)
		})

		const get = Effect.fn("ProjectionTurns.get")(function*(turnId: TurnId) {
			return yield* readByTurnId(sql, turnId)
		})

		const sessionTotals = Effect.fn("ProjectionTurns.sessionTotals")(function*(
			sessionId: SessionId
		) {
			const rows = yield* sql`
				SELECT
					COALESCE(SUM(input_tokens), 0) AS input_tokens,
					COALESCE(SUM(output_tokens), 0) AS output_tokens,
					COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
					COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
					COALESCE(SUM(cost_usd), 0) AS cost_usd
				FROM projection_turns
				WHERE session_id = ${sessionId}
			`.withoutTransform
			return yield* Option.match(Arr.head(rows), {
				onNone: () =>
					decodeStoredSessionUsage(sessionId, {
						input_tokens: 0,
						output_tokens: 0,
						cache_read_tokens: 0,
						cache_write_tokens: 0,
						cost_usd: 0
					}),
				onSome: (row) => decodeStoredSessionUsage(sessionId, row)
			})
		})

		return ProjectionTurns.of({
			name,
			apply,
			truncate,
			listBySession,
			get,
			sessionTotals
		})
	})
)
