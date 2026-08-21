import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSessionActivities = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_session_activities (
			activity_id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			status_sequence INTEGER NOT NULL DEFAULT 0,
			kind TEXT NOT NULL DEFAULT 'tool',
			tool_call_id TEXT,
			operation_id TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			title TEXT NOT NULL DEFAULT 'activity',
			path TEXT,
			CHECK (kind IN ('tool', 'file')),
			CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX projection_session_activities_session_sequence
		ON projection_session_activities (session_id, sequence)
	`.withoutTransform
})

export default projectionSessionActivities
