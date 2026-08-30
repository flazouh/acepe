import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

/**
 * Two live facts the voice projection had nowhere to keep: the current
 * microphone level and how far a model download has come. Both are null
 * outside the operation that produces them, so an existing row starts at
 * "null" spelled as JSON.
 */
const projectionVoiceProgress = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		ALTER TABLE projection_voice
		ADD COLUMN amplitude_json TEXT NOT NULL DEFAULT 'null'
	`.withoutTransform
	yield* sql`
		ALTER TABLE projection_voice
		ADD COLUMN download_json TEXT NOT NULL DEFAULT 'null'
	`.withoutTransform
})

export default projectionVoiceProgress
