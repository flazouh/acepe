import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionProjects = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_projects (
			project_id TEXT PRIMARY KEY NOT NULL,
			title TEXT NOT NULL,
			workspace_root TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT,
			session_count INTEGER NOT NULL DEFAULT 0,
			scan_warmed_at TEXT NOT NULL,
			CHECK (title <> ''),
			CHECK (workspace_root <> ''),
			CHECK (session_count >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE TABLE projection_projects_membership (
			session_id TEXT PRIMARY KEY NOT NULL,
			project_id TEXT NOT NULL,
			deleted_at TEXT
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX projection_projects_membership_project
		ON projection_projects_membership (project_id)
	`.withoutTransform
	yield* sql`
		CREATE INDEX projection_projects_updated_at
		ON projection_projects (updated_at, project_id)
	`.withoutTransform
})

export default projectionProjects
