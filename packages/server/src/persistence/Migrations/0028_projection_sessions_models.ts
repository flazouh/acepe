import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

/**
 * The two halves of a session's model, in one migration because neither is
 * worth anything alone: a catalog with nothing selectable is a picker that
 * does not pick, and a selection with no catalog is an id the user could never
 * have chosen.
 *
 * `current_model_id` mirrors `current_mode_id` from 0026. `available_models`
 * holds the provider's own catalog as JSON text, decoded through a schema, the
 * way projection_session_activities stores its input and output payloads.
 */
const projectionSessionsModels = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN current_model_id TEXT
	`.withoutTransform
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN available_models TEXT
	`.withoutTransform
})

export default projectionSessionsModels
