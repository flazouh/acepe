import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionState = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_state (
			name TEXT PRIMARY KEY NOT NULL,
			last_applied_sequence INTEGER NOT NULL
		)
	`.withoutTransform
})

export default projectionState
