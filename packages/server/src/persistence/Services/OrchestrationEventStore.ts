import {
	CommandId,
	CorrelationId,
	EventId,
	IsoDateTime,
	JsonObject,
	OrchestrationAggregateKind,
	OrchestrationEvent,
	OrchestrationEventType,
	Sequence
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import type { SqlError } from "effect/unstable/sql/SqlError"

export type NewOrchestrationEvent = OrchestrationEvent extends infer Event ?
	Event extends { readonly sequence: Sequence } ? Omit<Event, "sequence"> :
	never :
	never

export class OrchestrationEventStore extends Context.Service<OrchestrationEventStore, {
	readonly append: (
		events: ReadonlyArray<NewOrchestrationEvent>
	) => Effect.Effect<Sequence, SqlError | Schema.SchemaError>
	readonly readFrom: (
		sequence: Sequence,
		limit: number
	) => Stream.Stream<OrchestrationEvent, SqlError | Schema.SchemaError>
}>()("@acepe/server/persistence/Services/OrchestrationEventStore") {}

export const OrchestrationEventStoreRow = Schema.Struct({
	sequence: Sequence,
	event_id: EventId,
	aggregate_kind: OrchestrationAggregateKind,
	aggregate_id: Schema.String,
	occurred_at: IsoDateTime,
	command_id: CommandId,
	causation_event_id: Schema.NullOr(EventId),
	correlation_id: CorrelationId,
	metadata: Schema.fromJsonString(JsonObject),
	type: OrchestrationEventType,
	payload: Schema.fromJsonString(Schema.Unknown)
})

export const envelopeFromRow = (row: typeof OrchestrationEventStoreRow.Type) => ({
	sequence: row.sequence,
	eventId: row.event_id,
	aggregateKind: row.aggregate_kind,
	aggregateId: row.aggregate_id,
	occurredAt: row.occurred_at,
	commandId: row.command_id,
	causationEventId: row.causation_event_id,
	correlationId: row.correlation_id,
	metadata: row.metadata,
	type: row.type,
	payload: row.payload
})

export const rowFromNewEvent = (
	sequence: Sequence,
	event: NewOrchestrationEvent
): typeof OrchestrationEventStoreRow.Type => ({
	sequence,
	event_id: event.eventId,
	aggregate_kind: event.aggregateKind,
	aggregate_id: event.aggregateId,
	occurred_at: event.occurredAt,
	command_id: event.commandId,
	causation_event_id: event.causationEventId,
	correlation_id: event.correlationId,
	metadata: event.metadata,
	type: event.type,
	payload: event.payload
})

const decodeRow = Schema.decodeUnknownEffect(OrchestrationEventStoreRow)
const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent)

export const decodeStoredOrchestrationEvent = Effect.fn("decodeStoredOrchestrationEvent")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return yield* decodeEvent(envelopeFromRow(row))
	}
)
