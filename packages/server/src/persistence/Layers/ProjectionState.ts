import { Sequence, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ProjectionState } from "../Services/ProjectionState.ts"

const CheckpointRequest = Schema.Struct({
	name: TrimmedNonEmptyString,
	sequence: Sequence
})

const LastAppliedRow = Schema.Struct({
	last_applied_sequence: Sequence
})

const decodeCheckpointRequest = Schema.decodeUnknownEffect(CheckpointRequest)
const decodeProjectorName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)
const decodeLastAppliedRows = Schema.decodeUnknownEffect(Schema.NonEmptyArray(LastAppliedRow))

export const ProjectionStateLive = Layer.effect(ProjectionState)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient

		const writeCheckpoint = Effect.fn("ProjectionState.writeCheckpoint")(
			function*(request: typeof CheckpointRequest.Type) {
				yield* sql`
					INSERT INTO projection_state (name, last_applied_sequence)
					VALUES (${request.name}, ${request.sequence})
					ON CONFLICT(name) DO UPDATE SET
						last_applied_sequence = excluded.last_applied_sequence
				`.withoutTransform.pipe(Effect.asVoid)
			}
		)

		const readLastApplied = Effect.fn("ProjectionState.readLastApplied")(
			function*(name: typeof TrimmedNonEmptyString.Type) {
				const rows = yield* sql<{ last_applied_sequence: number }>`
					SELECT COALESCE(
						(
							SELECT last_applied_sequence
							FROM projection_state
							WHERE name = ${name}
						),
						0
					) AS last_applied_sequence
				`.withoutTransform
				const decoded = yield* decodeLastAppliedRows(rows)
				return decoded[0].last_applied_sequence
			}
		)

		const checkpoint = Effect.fn("ProjectionState.checkpoint")(function*(
			name: string,
			sequence: number
		) {
			const request = yield* decodeCheckpointRequest({ name, sequence })
			yield* sql.withTransaction(writeCheckpoint(request))
		})

		const lastApplied = Effect.fn("ProjectionState.lastApplied")(function*(name: string) {
			const projectorName = yield* decodeProjectorName(name)
			return yield* sql.withTransaction(readLastApplied(projectorName))
		})

		return ProjectionState.of({
			checkpoint,
			lastApplied
		})
	})
)
