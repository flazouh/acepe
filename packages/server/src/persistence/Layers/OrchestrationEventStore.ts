import { Sequence } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredOrchestrationEvent,
	type NewOrchestrationEvent,
	OrchestrationEventStore,
	OrchestrationEventStoreRow,
	rowFromNewEvent
} from "../Services/OrchestrationEventStore.ts"

const MaxSequenceRow = Schema.Struct({
	max_sequence: Sequence
})

const ReadFromRequest = Schema.Struct({
	sequence: Sequence,
	limit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})

const encodeRows = Schema.encodeEffect(Schema.Array(OrchestrationEventStoreRow))
const decodeReadFromRequest = Schema.decodeUnknownEffect(ReadFromRequest)

export const OrchestrationEventStoreLive = Layer.effect(OrchestrationEventStore)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient

		const readMaxSequence = Effect.fn("OrchestrationEventStore.readMaxSequence")(function*() {
			const rows = yield* sql<{ max_sequence: number }>`
				SELECT COALESCE(MAX(sequence), 0) AS max_sequence
				FROM orchestration_events
			`.withoutTransform
			const decoded = yield* Schema.decodeUnknownEffect(Schema.NonEmptyArray(MaxSequenceRow))(rows)
			return decoded[0].max_sequence
		})

		const insertEncodedRows = Effect.fn("OrchestrationEventStore.insertEncodedRows")(
			function*(rows: ReadonlyArray<typeof OrchestrationEventStoreRow.Encoded>) {
				if (!Arr.isReadonlyArrayNonEmpty(rows)) {
					return
				}
				yield* sql`INSERT INTO orchestration_events ${sql.insert(rows)}`.withoutTransform
			}
		)

		const appendEvents = Effect.fn("OrchestrationEventStore.appendEvents")(
			function*(events: ReadonlyArray<NewOrchestrationEvent>) {
				const currentMax = yield* readMaxSequence()
				if (!Arr.isReadonlyArrayNonEmpty(events)) {
					return currentMax
				}
				const rows = Arr.map(events, (event, index) => rowFromNewEvent(currentMax + 1 + index, event))
				const encoded = yield* encodeRows(rows)
				yield* insertEncodedRows(encoded)
				return currentMax + events.length
			}
		)

		const append = Effect.fn("OrchestrationEventStore.append")(function*(
			events: ReadonlyArray<NewOrchestrationEvent>
		) {
			return yield* sql.withTransaction(appendEvents(events))
		})

		const readPage = Effect.fn("OrchestrationEventStore.readPage")(function*(
			sequence: Sequence,
			limit: number
		) {
			const request = yield* decodeReadFromRequest({ sequence, limit })
			const rows = yield* sql`
				SELECT
					sequence,
					event_id,
					aggregate_kind,
					aggregate_id,
					occurred_at,
					command_id,
					causation_event_id,
					correlation_id,
					metadata,
					type,
					payload
				FROM orchestration_events
				WHERE sequence > ${request.sequence}
				ORDER BY sequence ASC
				LIMIT ${request.limit}
			`.withoutTransform
			return yield* Effect.forEach(rows, decodeStoredOrchestrationEvent)
		})

		const readFrom = (sequence: Sequence, limit: number) => Stream.fromArrayEffect(readPage(sequence, limit))

		return OrchestrationEventStore.of({
			append,
			readFrom
		})
	})
)
