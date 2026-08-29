import * as DateTime from "effect/DateTime"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export const TrimmedNonEmptyString = Schema.Trim.check(Schema.isNonEmpty())
export type TrimmedNonEmptyString = typeof TrimmedNonEmptyString.Type

export const StreamToken = Schema.String.check(Schema.isNonEmpty())
export type StreamToken = typeof StreamToken.Type

// The body of a transcript message. Unlike TrimmedNonEmptyString this keeps
// every space and newline the provider streamed. An assistant row grows one
// StreamToken at a time, so the running text is re-decoded on every fold; a
// trimming schema there ate the trailing space of a token and glued the next
// token to the previous word. Trimming for display belongs to the reader.
export const TranscriptText = Schema.String.check(Schema.isNonEmpty())
export type TranscriptText = typeof TranscriptText.Type

export const IsoDateTime = Schema.String.check(
	Schema.makeFilter((value: string) => Option.isSome(DateTime.make(value)), {
		expected: "an ISO-8601 date-time string",
	}),
)
export type IsoDateTime = typeof IsoDateTime.Type

export const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type Sequence = typeof Sequence.Type

export const CheckpointStatus = Schema.Literals(["ready", "missing", "error"])
export type CheckpointStatus = typeof CheckpointStatus.Type

export const CheckpointNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export type CheckpointNumber = typeof CheckpointNumber.Type

export const CheckpointFileCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type CheckpointFileCount = typeof CheckpointFileCount.Type

export const JsonObject = Schema.JsonObject
export type JsonObject = typeof JsonObject.Type
