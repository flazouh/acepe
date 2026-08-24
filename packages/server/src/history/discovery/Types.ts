import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Schema from "effect/Schema"

/**
 * Providers the read-time discovery scan supports. Matches
 * `HistoryProviderKind` in `../importer.ts` minus the providers that do not
 * have a Claude-shaped JSONL-under-slug-directory layout yet (cursor,
 * opencode, codex) -- this batch's critical path is the Claude reader that
 * `history.ts`/`acp.ts` both defer on. Adding a provider here means adding a
 * matching scan in `Scan.ts`, not widening this literal blindly.
 */
export const DiscoveryProviderKind = Schema.Literal("claude")
export type DiscoveryProviderKind = typeof DiscoveryProviderKind.Type

export const DiscoveredSession = Schema.Struct({
	id: TrimmedNonEmptyString,
	title: TrimmedNonEmptyString,
	provider: DiscoveryProviderKind,
	projectPath: TrimmedNonEmptyString,
	createdAtMs: Schema.Int,
	updatedAtMs: Schema.Int,
	sourcePath: TrimmedNonEmptyString
})
export type DiscoveredSession = typeof DiscoveredSession.Type

export const DiscoveredProject = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	provider: DiscoveryProviderKind,
	sessionCount: Schema.Int,
	lastActiveMs: Schema.Int
})
export type DiscoveredProject = typeof DiscoveredProject.Type
