import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const eventStore = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE orchestration_events (
			sequence INTEGER PRIMARY KEY NOT NULL,
			event_id TEXT NOT NULL,
			aggregate_kind TEXT NOT NULL,
			aggregate_id TEXT NOT NULL,
			occurred_at TEXT NOT NULL,
			command_id TEXT NOT NULL,
			causation_event_id TEXT,
			correlation_id TEXT NOT NULL,
			metadata TEXT NOT NULL,
			type TEXT NOT NULL,
			payload TEXT NOT NULL
		)
	`.withoutTransform
	yield* sql`
		CREATE UNIQUE INDEX orchestration_events_event_id_idx
		ON orchestration_events (event_id)
	`.withoutTransform
	yield* sql`
		CREATE INDEX orchestration_events_aggregate_sequence_idx
		ON orchestration_events (aggregate_kind, aggregate_id, sequence)
	`.withoutTransform
})

export default eventStore
