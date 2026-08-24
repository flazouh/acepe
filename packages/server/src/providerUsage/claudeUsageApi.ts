import * as DateTime from "effect/DateTime"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

// Wire shape of Claude's usage APIs (api.anthropic.com/api/oauth/usage and
// claude.ai/api/organizations/{org}/usage return the same shape). Field
// names match the JSON verbatim (snake_case) rather than being renamed to
// camelCase, mirroring provider_account_usage/mod.rs's
// ClaudeUsageApiResponse -- this is an internal decode-only type, not part
// of the public @acepe/contracts surface.

export const ClaudeUsageBucket = Schema.Struct({
	utilization: Schema.Number,
	resets_at: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ClaudeUsageBucket = typeof ClaudeUsageBucket.Type

export const ClaudeUsageApiResponse = Schema.Struct({
	five_hour: ClaudeUsageBucket.pipe(Schema.NullOr, Schema.optionalKey),
	seven_day: ClaudeUsageBucket.pipe(Schema.NullOr, Schema.optionalKey),
	seven_day_sonnet: ClaudeUsageBucket.pipe(Schema.NullOr, Schema.optionalKey),
	seven_day_opus: ClaudeUsageBucket.pipe(Schema.NullOr, Schema.optionalKey),
	seven_day_cowork: ClaudeUsageBucket.pipe(Schema.NullOr, Schema.optionalKey),
	extra_usage: ClaudeUsageBucket.pipe(Schema.NullOr, Schema.optionalKey),
})
export type ClaudeUsageApiResponse = typeof ClaudeUsageApiResponse.Type

const INTEGER_STRING = /^-?\d+$/

// Ported from parse_reset_timestamp_ms in mod.rs: a numeric string under
// 10_000_000_000 is seconds since epoch (multiplied up to ms); at or above
// that threshold it is already milliseconds; anything else is parsed as
// RFC3339. Returns null (not "now") when nothing parses, so callers never
// fabricate a reset time.
export const parseClaudeResetTimestampMs = (value: string | null | undefined): number | null => {
	if (value === null || value === undefined) {
		return null
	}
	const trimmed = value.trim()
	if (trimmed.length === 0) {
		return null
	}
	if (INTEGER_STRING.test(trimmed)) {
		const asNumber = Number(trimmed)
		return asNumber > 10_000_000_000 ? asNumber : asNumber * 1_000
	}
	return Option.match(DateTime.make(trimmed), {
		onNone: () => null,
		onSome: (dt) => DateTime.toEpochMillis(dt),
	})
}
