import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionTurns = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_turns (
			turn_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'running',
			started_at TEXT,
			ended_at TEXT,
			cancelled_at TEXT,
			input_tokens INTEGER NOT NULL DEFAULT 0,
			output_tokens INTEGER NOT NULL DEFAULT 0,
			cache_read_tokens INTEGER NOT NULL DEFAULT 0,
			cache_write_tokens INTEGER NOT NULL DEFAULT 0,
			cost_usd REAL NOT NULL DEFAULT 0,
			CHECK (status IN ('running', 'completed', 'cancelled')),
			CHECK (input_tokens >= 0),
			CHECK (output_tokens >= 0),
			CHECK (cache_read_tokens >= 0),
			CHECK (cache_write_tokens >= 0),
			CHECK (cost_usd >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX projection_turns_session_sequence
		ON projection_turns (session_id, sequence)
	`.withoutTransform
})

export default projectionTurns
