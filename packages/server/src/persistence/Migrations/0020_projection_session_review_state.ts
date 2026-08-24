import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSessionReviewState = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_session_review_state (
			session_id TEXT NOT NULL,
			revision_key TEXT NOT NULL,
			file_path TEXT NOT NULL,
			reviewed INTEGER NOT NULL,
			sequence INTEGER NOT NULL,
			PRIMARY KEY (session_id, revision_key),
			CHECK (session_id <> ''),
			CHECK (revision_key <> ''),
			CHECK (file_path <> ''),
			CHECK (reviewed IN (0, 1)),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_session_review_state_session
		ON projection_session_review_state (session_id)
	`.withoutTransform
})

export default projectionSessionReviewState
