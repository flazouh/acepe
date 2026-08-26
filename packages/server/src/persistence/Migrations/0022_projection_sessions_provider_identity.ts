import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSessionsProviderIdentity = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN provider_session_id TEXT
	`.withoutTransform
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN provider_session_failed INTEGER NOT NULL DEFAULT 0
	`.withoutTransform
})

export default projectionSessionsProviderIdentity
