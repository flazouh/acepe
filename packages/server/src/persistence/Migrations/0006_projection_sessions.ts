import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSessions = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_sessions (
			session_id TEXT PRIMARY KEY NOT NULL,
			project_id TEXT NOT NULL,
			title TEXT NOT NULL,
			provider TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_activity_at TEXT NOT NULL,
			archived_at TEXT,
			deleted_at TEXT,
			CHECK (title <> '')
		)
	`.withoutTransform
})

export default projectionSessions
