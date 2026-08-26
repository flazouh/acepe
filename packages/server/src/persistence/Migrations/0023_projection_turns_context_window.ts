import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// AC-269: the Claude Code working line's token segment needs the running
// turn's context-window size (already carried by UsageFact/TurnUsageObserved)
// to reach the client -- projection_turns already had input/output/cache/cost
// columns (0007_projection_turns.ts) but nothing for context window size.
const projectionTurnsContextWindow = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_turns
		ADD COLUMN context_window_size INTEGER
	`.withoutTransform
})

export default projectionTurnsContextWindow
