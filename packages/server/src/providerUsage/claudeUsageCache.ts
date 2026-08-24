import { ProviderUsageWindow } from "@acepe/contracts"
import * as Schema from "effect/Schema"

// Ported from ClaudeUsageSnapshot / CLAUDE_USAGE_CACHE_TTL_MS in mod.rs.
// Used for both the in-memory 30s-TTL cache (avoids hammering the Claude
// usage API/Keychain on every widget poll) and the on-disk fallback cache
// (survives a process restart when the live fetch is down) -- same shape,
// same schema, two storage locations.

export const CLAUDE_USAGE_CACHE_TTL_MS = 30_000

export const ClaudeUsageSnapshotCache = Schema.Struct({
	capturedAtMs: Schema.Int,
	plan: Schema.String.pipe(Schema.NullOr),
	windows: Schema.Array(ProviderUsageWindow),
})
export type ClaudeUsageSnapshotCache = typeof ClaudeUsageSnapshotCache.Type

const claudeUsageSnapshotCacheJson = Schema.fromJsonString(ClaudeUsageSnapshotCache)
export const decodeClaudeUsageSnapshotCacheJson = Schema.decodeUnknownEffect(claudeUsageSnapshotCacheJson)
export const encodeClaudeUsageSnapshotCacheJson = Schema.encodeEffect(claudeUsageSnapshotCacheJson)
