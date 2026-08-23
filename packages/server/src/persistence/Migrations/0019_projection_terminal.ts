import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionTerminal = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_terminal (
			terminal_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			cwd TEXT NOT NULL,
			cols INTEGER NOT NULL,
			rows INTEGER NOT NULL,
			output TEXT NOT NULL,
			closed INTEGER NOT NULL,
			sequence INTEGER NOT NULL,
			CHECK (terminal_id <> ''),
			CHECK (session_id <> ''),
			CHECK (cwd <> ''),
			CHECK (cols >= 1),
			CHECK (rows >= 1),
			CHECK (closed IN (0, 1)),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_terminal_session
		ON projection_terminal (session_id)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_terminal_sequence
		ON projection_terminal (sequence)
	`.withoutTransform
})

export default projectionTerminal
