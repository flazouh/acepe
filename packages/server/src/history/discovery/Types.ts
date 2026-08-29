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

const scannedSessionFields = {
	id: TrimmedNonEmptyString,
	title: TrimmedNonEmptyString,
	provider: DiscoveryProviderKind,
	projectPath: TrimmedNonEmptyString,
	createdAtMs: Schema.Int,
	updatedAtMs: Schema.Int,
	sourcePath: TrimmedNonEmptyString
}

/**
 * What the filesystem walk alone can tell you about a session file.
 * `Scan.ts` produces these and nothing more: that layer never reads the
 * event store, so it cannot say who started a session.
 */
export const ScannedSession = Schema.Struct(scannedSessionFields)
export type ScannedSession = typeof ScannedSession.Type

/**
 * Who wrote the session file. `acepe` means Acepe's own event store knows
 * this session; `external` means the provider CLI wrote it outside Acepe.
 *
 * Only a join against `projection_sessions` answers this. The JSONL carries
 * no reliable marker of its own -- `entrypoint` is inherited through
 * `CLAUDE_CODE_ENTRYPOINT`, so a session Acepe never started can still
 * carry Acepe's entrypoint value.
 */
export const SessionOrigin = Schema.Literals(["acepe", "external"])
export type SessionOrigin = typeof SessionOrigin.Type

export const DiscoveredSession = Schema.Struct({
	...scannedSessionFields,
	origin: SessionOrigin
})
export type DiscoveredSession = typeof DiscoveredSession.Type

export const DiscoveredProject = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	provider: DiscoveryProviderKind,
	sessionCount: Schema.Int,
	lastActiveMs: Schema.Int
})
export type DiscoveredProject = typeof DiscoveredProject.Type
