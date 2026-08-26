import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// AC-280 root fix: the provider's tool classification ("edit", "execute",
// "read", ...) is canonical product truth (see ToolCallObservedPayload.kind
// in @acepe/contracts), but 0008's table had no column for it, so a reopened
// session had nothing to read and the client re-parsed the display title --
// which fails for path-bearing titles like "Write /abs/path". Nullable with
// no default: a call the provider never classified projects to NULL, which is
// also what every row written before this column existed reads back as.
const projectionSessionActivitiesToolKind = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_session_activities
		ADD COLUMN tool_kind TEXT
	`.withoutTransform
})

export default projectionSessionActivitiesToolKind
