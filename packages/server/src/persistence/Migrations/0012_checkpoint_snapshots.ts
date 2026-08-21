import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const checkpointSnapshots = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE checkpoints (
			id TEXT PRIMARY KEY NOT NULL,
			session_id TEXT NOT NULL,
			checkpoint_number INTEGER NOT NULL,
			name TEXT,
			created_at INTEGER NOT NULL,
			tool_call_id TEXT,
			is_auto INTEGER NOT NULL DEFAULT 1,
			CHECK (checkpoint_number >= 1),
			CHECK (is_auto IN (0, 1))
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_checkpoints_session
		ON checkpoints (session_id)
	`.withoutTransform
	yield* sql`
		CREATE UNIQUE INDEX idx_checkpoints_session_number_unique
		ON checkpoints (session_id, checkpoint_number)
	`.withoutTransform
	yield* sql`
		CREATE TABLE file_snapshots (
			id TEXT PRIMARY KEY NOT NULL,
			checkpoint_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			content TEXT NOT NULL,
			file_size INTEGER NOT NULL,
			lines_added INTEGER,
			lines_removed INTEGER,
			FOREIGN KEY (checkpoint_id) REFERENCES checkpoints (id) ON DELETE CASCADE
		)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_snapshots_checkpoint
		ON file_snapshots (checkpoint_id)
	`.withoutTransform
	yield* sql`
		CREATE INDEX idx_snapshots_hash
		ON file_snapshots (content_hash)
	`.withoutTransform
	yield* sql`
		CREATE UNIQUE INDEX idx_snapshots_checkpoint_path
		ON file_snapshots (checkpoint_id, file_path)
	`.withoutTransform
})

export default checkpointSnapshots
