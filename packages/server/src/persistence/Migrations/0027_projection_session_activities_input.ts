import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// A tool observation carries the tool's own arguments (see
// ToolCallObservedPayload.input in @acepe/contracts). For an edit or a write
// those arguments are the change itself, and without them a person is asked to
// approve something nobody can see: the title and path name the file, never
// what would happen to it. Stored as TEXT holding the payload's JSON, the same
// way the rest of this table keeps provider-shaped values. Nullable with no
// default: a call whose provider sent no arguments projects to NULL, which is
// also what every row written before this column existed reads back as.
const projectionSessionActivitiesInput = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_session_activities
		ADD COLUMN input TEXT
	`.withoutTransform
})

export default projectionSessionActivitiesInput
