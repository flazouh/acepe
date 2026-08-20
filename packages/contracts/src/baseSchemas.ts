import * as DateTime from "effect/DateTime"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export const TrimmedNonEmptyString = Schema.Trim.check(Schema.isNonEmpty())
export type TrimmedNonEmptyString = typeof TrimmedNonEmptyString.Type

export const IsoDateTime = Schema.String.check(
	Schema.makeFilter((value: string) => Option.isSome(DateTime.make(value)), {
		expected: "an ISO-8601 date-time string",
	}),
)
export type IsoDateTime = typeof IsoDateTime.Type

export const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type Sequence = typeof Sequence.Type

export const JsonObject = Schema.JsonObject
export type JsonObject = typeof JsonObject.Type
