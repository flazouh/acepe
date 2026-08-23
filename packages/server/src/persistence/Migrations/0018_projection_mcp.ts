import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionMcp = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_mcp (
			project_id TEXT PRIMARY KEY NOT NULL,
			catalog_json TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			options_json TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			CHECK (project_id <> ''),
			CHECK (provider_id <> ''),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_mcp_sequence
		ON projection_mcp (sequence)
	`.withoutTransform
})

export default projectionMcp
