import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const commandReceipts = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		CREATE TABLE orchestration_command_receipts (
			command_id TEXT PRIMARY KEY NOT NULL,
			status TEXT NOT NULL,
			result_sequence INTEGER,
			reason TEXT,
			CHECK (status IN ('accepted', 'rejected')),
			CHECK (
				(status = 'accepted' AND result_sequence IS NOT NULL AND reason IS NULL)
				OR
				(status = 'rejected' AND result_sequence IS NULL AND reason IS NOT NULL)
			)
		)
	`.withoutTransform
})

export default commandReceipts
