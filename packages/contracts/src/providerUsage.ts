import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import * as Schema from "effect/Schema"

// The getProviderAccountUsage utility RPC (see rpc.ts). Ported from the
// desktop app's former native provider-account-usage module: the top-bar
// usage widget's per-provider quota windows (Codex's on-disk rollout files,
// Claude's OAuth/cookie-backed usage API, Cursor always unavailable pending
// an account API). Response shape is byte-for-byte the same camelCase fields
// the old backend command returned, so the desktop consumer's mapping logic
// did not need to change -- only its transport.
//
// A provider whose data cannot be read reports connection: "unavailable"
// with a human-readable `message` instead of omitting itself or fabricating
// zeros -- the request itself never fails for a single provider's outage.

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const ProviderUsageProviderId = Schema.Literals(["codex", "claude-code", "cursor"])
export type ProviderUsageProviderId = typeof ProviderUsageProviderId.Type

export const ProviderUsageWindowRole = Schema.Literals([
	"primaryShort",
	"weekly",
	"overage",
	"other",
])
export type ProviderUsageWindowRole = typeof ProviderUsageWindowRole.Type

export const ProviderAccountConnection = Schema.Literals([
	"connected",
	"notConnected",
	"unavailable",
])
export type ProviderAccountConnection = typeof ProviderAccountConnection.Type

export const ProviderUsageWindow = Schema.Struct({
	id: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
	role: ProviderUsageWindowRole,
	usedFraction: Schema.Number,
	windowMinutes: NonNegativeInt,
	resetsAtMs: Schema.NullOr(NonNegativeInt),
})
export type ProviderUsageWindow = typeof ProviderUsageWindow.Type

export const ProviderAccountUsage = Schema.Struct({
	providerId: TrimmedNonEmptyString,
	displayName: TrimmedNonEmptyString,
	plan: Schema.NullOr(Schema.String),
	capturedAtMs: NonNegativeInt,
	connection: ProviderAccountConnection,
	windows: Schema.Array(ProviderUsageWindow),
	message: Schema.NullOr(Schema.String),
})
export type ProviderAccountUsage = typeof ProviderAccountUsage.Type

export const GetProviderAccountUsageRequest = Schema.Struct({
	// Optional filter to a single provider. Omitted (or absent) returns every
	// known provider, matching the Rust command's only behavior.
	provider: Schema.optionalKey(ProviderUsageProviderId),
})
export type GetProviderAccountUsageRequest = typeof GetProviderAccountUsageRequest.Type

export const GetProviderAccountUsageResponse = Schema.Array(ProviderAccountUsage)
export type GetProviderAccountUsageResponse = typeof GetProviderAccountUsageResponse.Type
