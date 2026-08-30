import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Marks a session Acepe opened to do a job of its own -- today the ship card's
 * one hidden turn that writes a commit message and PR copy -- rather than a
 * thread the user started. The session library excludes these, so the sidebar
 * stops listing "Generate a git commit message and pull request..." next to
 * real work.
 *
 * NOT NULL DEFAULT 0: every session that existed before this column was a
 * normal listed one, and that is exactly what 0 means. No backfill needed.
 */
const projectionSessionsEphemeral = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0
	`.withoutTransform;
});

export default projectionSessionsEphemeral;
