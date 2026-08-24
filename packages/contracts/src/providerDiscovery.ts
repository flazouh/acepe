import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import * as Schema from "effect/Schema"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Read-time provider discovery (#249 batch 3): sessions/projects a
 * provider (Claude Code, ...) has on disk, independent of whether Acepe
 * has imported them into the orchestration event store yet.
 */
export const ProviderKind = Schema.Literal("claude")
export type ProviderKind = typeof ProviderKind.Type

export const DiscoveredProviderSession = Schema.Struct({
	id: TrimmedNonEmptyString,
	title: TrimmedNonEmptyString,
	provider: ProviderKind,
	projectPath: TrimmedNonEmptyString,
	createdAtMs: NonNegativeInt,
	updatedAtMs: NonNegativeInt,
	sourcePath: TrimmedNonEmptyString,
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
