import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

/**
 * The sidebar's project order. Nullable on purpose: null means nobody has ever
 * ordered this project, and the first Move Up/Move Down ranks the whole list at
 * once, so there is nothing sensible to backfill here.
 */
const projectionProjectsSortOrder = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_projects
		ADD COLUMN sort_order INTEGER
	`.withoutTransform
})

export default projectionProjectsSortOrder
