import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const projectionSettings = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE projection_settings (
			setting_key TEXT PRIMARY KEY NOT NULL,
			setting_value TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			CHECK (setting_key <> ''),
			CHECK (sequence >= 0)
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_projection_settings_sequence
		ON projection_settings (sequence)
	`.withoutTransform
})

export default projectionSettings
