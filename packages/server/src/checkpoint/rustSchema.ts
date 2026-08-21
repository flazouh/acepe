import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

/**
 * Column order dumped from ~/Library/Application Support/Acepe/acepe.db
 * on 2026-08-21. The TypeScript reader must keep this layout.
 */
export const RUST_CHECKPOINT_COLUMNS = [
	"id",
	"session_id",
	"checkpoint_number",
	"name",
	"created_at",
	"tool_call_id",
	"is_auto"
] as const

export const RUST_FILE_SNAPSHOT_COLUMNS = [
	"id",
	"checkpoint_id",
	"file_path",
	"content_hash",
	"content",
	"file_size",
	"lines_added",
	"lines_removed"
] as const

/**
 * Live Tauri schema, including the session_metadata foreign key.
 * Tests use this to prove the reader accepts a Rust-created database.
 */
export const applyLiveRustCheckpointSchema = Effect.fn("applyLiveRustCheckpointSchema")(
	function*() {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			CREATE TABLE IF NOT EXISTS "session_metadata" (
				"id" text NOT NULL PRIMARY KEY
			)
		`.withoutTransform
		yield* sql`
			CREATE TABLE IF NOT EXISTS "checkpoints" (
				"id" text NOT NULL PRIMARY KEY,
				"session_id" text NOT NULL,
				"checkpoint_number" integer NOT NULL,
				"name" text,
				"created_at" bigint NOT NULL,
				"tool_call_id" text,
				"is_auto" integer NOT NULL DEFAULT 1,
				FOREIGN KEY ("session_id") REFERENCES "session_metadata" ("id") ON DELETE CASCADE
			)
		`.withoutTransform
		yield* sql`
			CREATE INDEX IF NOT EXISTS "idx_checkpoints_session"
			ON "checkpoints" ("session_id")
		`.withoutTransform
		yield* sql`
			CREATE UNIQUE INDEX IF NOT EXISTS "idx_checkpoints_session_number_unique"
			ON "checkpoints" ("session_id", "checkpoint_number")
		`.withoutTransform
		yield* sql`
			CREATE TABLE IF NOT EXISTS "file_snapshots" (
				"id" text NOT NULL PRIMARY KEY,
				"checkpoint_id" text NOT NULL,
				"file_path" text NOT NULL,
				"content_hash" text NOT NULL,
				"content" text NOT NULL,
				"file_size" bigint NOT NULL,
				"lines_added" integer NULL,
				"lines_removed" integer NULL,
				FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoints" ("id") ON DELETE CASCADE
			)
		`.withoutTransform
		yield* sql`
			CREATE INDEX IF NOT EXISTS "idx_snapshots_checkpoint"
			ON "file_snapshots" ("checkpoint_id")
		`.withoutTransform
		yield* sql`
			CREATE INDEX IF NOT EXISTS "idx_snapshots_hash"
			ON "file_snapshots" ("content_hash")
		`.withoutTransform
		yield* sql`
			CREATE UNIQUE INDEX IF NOT EXISTS "idx_snapshots_checkpoint_path"
			ON "file_snapshots" ("checkpoint_id", "file_path")
		`.withoutTransform
	}
)
