import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionGitReview = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_git_review (
			project_id TEXT PRIMARY KEY NOT NULL,
			status_json TEXT NOT NULL,
			files_json TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			CHECK (project_id <> ''),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_git_review_sequence
		ON projection_git_review (sequence)
	`.withoutTransform
})

export default projectionGitReview
