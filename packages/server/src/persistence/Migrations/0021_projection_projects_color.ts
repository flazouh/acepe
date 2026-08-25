import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionProjectsColor = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_projects
		ADD COLUMN color TEXT
	`.withoutTransform
})

export default projectionProjectsColor
