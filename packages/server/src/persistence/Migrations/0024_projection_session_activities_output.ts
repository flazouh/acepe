import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// #273: a tool call's output is canonical product truth (see
// ToolCallObservedPayload's output in @acepe/contracts) and every provider
// used to drop it at the publish boundary, so 0008's table has no column for
// it. Nullable with no default: a tool call that reported no output projects
// to NULL, which is also what every row written before this column existed
// reads back as.
const projectionSessionActivitiesOutput = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_session_activities
		ADD COLUMN output TEXT
	`.withoutTransform
})

export default projectionSessionActivitiesOutput
