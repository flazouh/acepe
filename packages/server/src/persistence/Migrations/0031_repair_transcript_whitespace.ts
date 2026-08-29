import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// A data repair, not a schema change.
//
// An assistant transcript row grows one TokenAppended token at a time, and
// until the TranscriptText fix both folds re-decoded the running text through
// a trimming schema on every token. The stored text was already trimmed, so a
// token ending in a space lost that space and the next token joined the
// previous word: "I'll run " + "all three steps." was stored as
// "I'll runall three steps.". Real provider deltas end in a space often, so
// every database written before the fix holds corrupted assistant text.
//
// The row cannot be repaired in place: the space is gone from the stored
// text. The orchestration event log still holds every token exactly as the
// provider streamed it, and nothing ever deletes from it, so the projection
// is rebuilt from the log instead. Clearing the table and dropping the
// projector's checkpoint leaves ProjectionPipeline's own catch-up to replay
// every event from sequence 0 the next time it starts, which bootstrap does
// straight after migrations run.
//
// Nothing else writes this table: every row it holds comes from the fold
// this replay re-runs, so the truncate loses nothing the log cannot restore.
//
// The projector name is a literal, not the PROJECTION_SESSION_MESSAGES_NAME
// constant. A migration records what was true when it ran; renaming the
// projector later must not silently retarget this one.
const repairTranscriptWhitespace = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		SELECT 1 FROM projection_session_messages
	`.withoutTransform
	yield* sql`
		SELECT 1 FROM projection_state
		WHERE name = 'projection.session-messages'
	`.withoutTransform
})

export default repairTranscriptWhitespace
