import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionProjectsShowExternalCliSessions = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_projects
		ADD COLUMN show_external_cli_sessions INTEGER
	`.withoutTransform
})

export default projectionProjectsShowExternalCliSessions
