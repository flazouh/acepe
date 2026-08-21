import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

export const IsoDateTime = Schema.String.check(
	Schema.makeFilter((value: string) => Option.isSome(DateTime.make(value)), {
		expected: "an ISO-8601 date-time string",
	}),
)
export type IsoDateTime = typeof IsoDateTime.Type

export const RecordedExchange = Schema.Struct({
	recordedAt: IsoDateTime,
	command: Schema.String.check(Schema.isNonEmpty()),
	payload: Schema.Json,
	response: Schema.Json,
	notifications: Schema.Array(Schema.Json),
})
export type RecordedExchange = typeof RecordedExchange.Type

export const RecordedExchangeLine = Schema.fromJsonString(RecordedExchange)
export const JsonLine = Schema.fromJsonString(Schema.Json)

export const REFERENCE_FIXTURE_FILE_NAME = "claude-session-reference.ndjson"
export const TRACER_BULLET_FIXTURE_FILE_NAME = "tracer-bullet-reference.ndjson"

export const decodeJsonLine = Effect.fn("decodeJsonLine")((line: string) =>
	Schema.decodeUnknownEffect(JsonLine)(line),
)

export const encodeJsonLine = Effect.fn("encodeJsonLine")((value: Schema.Json) =>
	Schema.encodeUnknownEffect(JsonLine)(value),
)

export const decodeExchangeLine = Effect.fn("decodeExchangeLine")((line: string) =>
	Schema.decodeUnknownEffect(RecordedExchangeLine)(line),
)

export const encodeExchangeLine = Effect.fn("encodeExchangeLine")((exchange: RecordedExchange) =>
	Schema.encodeUnknownEffect(RecordedExchangeLine)(exchange),
)

export const fixtureFileName = (recordedAt: DateTime.DateTime): string =>
	`${recordedAt.pipe(DateTime.formatIso, Str.replaceAll(":", "-"))}.ndjson`

export const referenceFixturePath = Effect.fn("referenceFixturePath")(function* () {
	const path = yield* Path.Path
	const here = yield* path.fromFileUrl(new URL(import.meta.url))
	return path.join(path.dirname(here), "..", "fixtures", REFERENCE_FIXTURE_FILE_NAME)
})

export const tracerBulletFixturePath = Effect.fn("tracerBulletFixturePath")(function* () {
	const path = yield* Path.Path
	const here = yield* path.fromFileUrl(new URL(import.meta.url))
	return path.join(path.dirname(here), "..", "fixtures", TRACER_BULLET_FIXTURE_FILE_NAME)
})
