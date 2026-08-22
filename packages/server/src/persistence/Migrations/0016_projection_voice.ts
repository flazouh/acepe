import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionVoice = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_voice (
			voice_id TEXT PRIMARY KEY NOT NULL,
			models_json TEXT NOT NULL,
			languages_json TEXT NOT NULL,
			recording_json TEXT NOT NULL,
			last_transcription_json TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			CHECK (voice_id <> ''),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_voice_sequence
		ON projection_voice (sequence)
	`.withoutTransform
})

export default projectionVoice
