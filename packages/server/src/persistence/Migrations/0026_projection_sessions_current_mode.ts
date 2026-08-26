import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSessionsCurrentMode = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN current_mode_id TEXT
	`.withoutTransform
})

export default projectionSessionsCurrentMode
