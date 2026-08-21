import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionCheckpoints = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_checkpoints (
			checkpoint_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			checkpoint_number INTEGER NOT NULL,
			name TEXT,
			is_auto INTEGER NOT NULL,
			tool_call_id TEXT,
			file_count INTEGER NOT NULL,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			last_reverted_at TEXT,
			UNIQUE (session_id, checkpoint_number),
			CHECK (checkpoint_number >= 1),
			CHECK (file_count >= 0),
			CHECK (is_auto IN (0, 1)),
			CHECK (status IN ('ready', 'missing', 'error'))
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_checkpoints_session
		ON projection_checkpoints (session_id, checkpoint_number)
	`.withoutTransform
})

export default projectionCheckpoints
