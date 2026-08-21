import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSessionsPrLink = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN pr_number INTEGER
	`.withoutTransform
	yield* sql`
		ALTER TABLE projection_sessions
		ADD COLUMN pr_link_mode TEXT
	`.withoutTransform
})

export default projectionSessionsPrLink
