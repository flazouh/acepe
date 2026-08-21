import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionMessages = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_session_messages (
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			message_id TEXT NOT NULL,
			turn_id TEXT,
			row_type TEXT NOT NULL,
			content TEXT NOT NULL,
			PRIMARY KEY (session_id, sequence),
			CHECK (row_type IN ('user', 'assistant', 'compaction'))
		)
	`.withoutTransform
})

export default projectionMessages
