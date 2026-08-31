import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

/**
 * The config option values a session chose, folded from canonical
 * SessionConfigOptionSet events (latest value per key, as JSON text decoded
 * through a schema -- see StoredSessionConfigOptionValues). Mirrors
 * `current_mode_id` from 0026: until this column existed the event was
 * committed and applied to the provider at the next (re)open, but no
 * projection served it, so the composer's Reasoning Effort widget read the
 * provider catalog's "auto" default after every restart.
 */
const projectionSessionsConfigOptions = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN config_options TEXT
	`.withoutTransform
})

export default projectionSessionsConfigOptions
