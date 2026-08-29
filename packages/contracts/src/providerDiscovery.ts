import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import { SessionId } from "./ids.ts"
import * as Schema from "effect/Schema"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Read-time provider discovery (#249 batch 3): sessions/projects a
 * provider (Claude Code, ...) has on disk, independent of whether Acepe
 * has imported them into the orchestration event store yet.
 */
export const ProviderKind = Schema.Literal("claude")
export type ProviderKind = typeof ProviderKind.Type

/**
 * Who wrote the session file. `acepe` means Acepe's own event store knows
 * this session (its `session_id` or its `provider_session_id` matches);
 * `external` means the provider CLI wrote it outside Acepe -- another
 * terminal, another editor, or an automation run.
 *
 * The join against the projection is the only trustworthy answer. The JSONL
 * carries no reliable marker of its own: `entrypoint` is inherited through
 * `CLAUDE_CODE_ENTRYPOINT`, so a session Acepe never started can still claim
 * Acepe's entrypoint value.
 */
export const ProviderSessionOrigin = Schema.Literals(["acepe", "external"])
export type ProviderSessionOrigin = typeof ProviderSessionOrigin.Type

export const DiscoveredProviderSession = Schema.Struct({
	id: TrimmedNonEmptyString,
	title: TrimmedNonEmptyString,
	provider: ProviderKind,
	projectPath: TrimmedNonEmptyString,
	createdAtMs: NonNegativeInt,
	updatedAtMs: NonNegativeInt,
	sourcePath: TrimmedNonEmptyString,
	origin: ProviderSessionOrigin,
})
export type DiscoveredProviderSession = typeof DiscoveredProviderSession.Type

export const DiscoveredProviderProject = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
	provider: ProviderKind,
	sessionCount: NonNegativeInt,
	lastActiveMs: NonNegativeInt,
})
export type DiscoveredProviderProject = typeof DiscoveredProviderProject.Type

export const ListProviderSessionsRequest = Schema.Struct({
	projectPath: TrimmedNonEmptyString,
})
export type ListProviderSessionsRequest = typeof ListProviderSessionsRequest.Type

export const ListProviderProjectsRequest = Schema.Struct({})
export type ListProviderProjectsRequest = typeof ListProviderProjectsRequest.Type

/**
 * Utility RPC (#249 batch 3, precedent: `invalidateProjectIndex`): imports
 * one discovered provider session into the orchestration event store, on
 * demand -- opening a session, or renaming/re-linking one that has not been
 * imported yet, both need this before they can dispatch further commands
 * against it. `projectPath`+`sessionId` (rather than a raw file path) so the
 * server resolves the source file itself through the same discovery scan
 * `listProviderSessions` uses: the webview never gets to name an arbitrary
 * path on disk.
 */
export const ImportProviderSessionRequest = Schema.Struct({
	provider: ProviderKind,
	projectPath: TrimmedNonEmptyString,
	sessionId: TrimmedNonEmptyString,
})
export type ImportProviderSessionRequest = typeof ImportProviderSessionRequest.Type

export const ImportProviderSessionResult = Schema.Struct({
	sessionId: SessionId,
	// True when this call performed the import; false when discovery found
	// no such session (idempotent no-op). A second import of an
	// already-imported session also reports `true` here -- the underlying
	// dispatch is idempotent via deterministic commandIds, so re-running it
	// is cheap and always safe to call speculatively.
	imported: Schema.Boolean,
})
export type ImportProviderSessionResult = typeof ImportProviderSessionResult.Type
