import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// An assistant transcript row is the only projected row this table folds
// instead of replaces: a TokenAppended event appends its token to the text
// the row already holds, so the row's `sequence` column names the FIRST
// token of the message and nothing recorded how far the fold had got.
// Every other projector survives a second delivery of one event because its
// apply is an upsert keyed by (session_id, sequence); this one appended the
// same tokens again and the transcript showed the assistant reply twice,
// concatenated with no separation.
//
// `last_sequence` is the highest event sequence folded into the row, so
// applyToken can recognise an event it already folded and do nothing.
// Nullable with no default: rows written before this column existed read
// back as NULL, which the projector reads as "only the first token's
// sequence is known".
const projectionSessionMessagesLastSequence = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_session_messages
		ADD COLUMN last_sequence INTEGER
	`.withoutTransform
})

export default projectionSessionMessagesLastSequence
