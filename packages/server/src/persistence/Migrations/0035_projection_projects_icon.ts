import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Which icon a project shows, as the user's choice rather than a resolved file.
 *
 * The Tauri schema carried this as one `projects.icon_path` column holding an
 * absolute path, added alongside `sort_order` in
 * m20260413_000001_add_project_sidebar_metadata. Only `sort_order` was ported
 * (migration 0033), so every reader of the icon downstream was writing to a
 * column that no longer existed.
 *
 * Two columns, because SQLite has no union type and the choice has three arms:
 *
 *   icon_kind | icon_path | meaning
 *   ----------+-----------+-------------------------------------------------
 *   NULL      | NULL      | auto: detect from the project's own files
 *   'custom'  | set       | this file, relative to the workspace root
 *   'none'    | NULL      | the letter badge, and detection stays off
 *
 * Both null is "auto", so every existing row already means the right thing and
 * there is nothing to backfill. The old startup backfill went away with it.
 *
 * The detected path is deliberately absent. Storing it is what let the Tauri
 * column outlive the file it named, and what made a row valid on one machine
 * and broken on another.
 */
const projectionProjectsIcon = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
		ALTER TABLE projection_projects
		ADD COLUMN icon_kind TEXT
	`.withoutTransform;
	yield* sql`
		ALTER TABLE projection_projects
		ADD COLUMN icon_path TEXT
	`.withoutTransform;
});

export default projectionProjectsIcon;
