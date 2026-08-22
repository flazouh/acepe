import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSkills = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_skills_catalog (
			catalog_id TEXT PRIMARY KEY NOT NULL,
			agents_json TEXT NOT NULL,
			agent_skills_json TEXT NOT NULL,
			plugins_json TEXT NOT NULL,
			plugin_skills_json TEXT NOT NULL,
			tree_json TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			CHECK (catalog_id <> ''),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_skills_catalog_sequence
		ON projection_skills_catalog (sequence)
	`.withoutTransform
})

export default projectionSkills
