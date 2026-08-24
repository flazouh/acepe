import type { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Ref from "effect/Ref"
import { claudeProjectsRoot } from "./Roots.ts"
import {
	listClaudeProjects,
	listClaudeSessionsForProject,
	projectDirectorySignature,
	rootDirectorySignature
} from "./Scan.ts"
import type { DiscoveredProject, DiscoveredSession } from "./Types.ts"

/**
 * Read-time provider discovery (#249 batch 3): the service `history.ts` and
 * `acp.ts` both defer session-open hydration on. Backs the
 * `listProviderSessions`/`listProviderProjects` RPCs.
 */
export type ProviderSessionDiscoveryShape = {
	readonly listSessionsForProject: (
		projectPath: TrimmedNonEmptyString
	) => Effect.Effect<ReadonlyArray<DiscoveredSession>, PlatformError>
	readonly listProjects: () => Effect.Effect<ReadonlyArray<DiscoveredProject>, PlatformError>
}

export class ProviderSessionDiscovery extends Context.Service<
	ProviderSessionDiscovery,
	ProviderSessionDiscoveryShape
>()("@acepe/server/history/discovery/ProviderSessionDiscovery") {}

type ProjectCacheEntry = {
	readonly signature: string
	readonly sessions: ReadonlyArray<DiscoveredSession>
}

type AllProjectsCacheEntry = {
	readonly signature: string
	readonly projects: ReadonlyArray<DiscoveredProject>
}

export const ProviderSessionDiscoveryLive = Layer.effect(
	ProviderSessionDiscovery,
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		// Resolved once at layer construction: HOME/CLAUDE_HOME do not change
		// while the server runs, and closing over the resolved root keeps
		// Config/Path out of every call's requirement and error channel.
		const projectsRoot = yield* claudeProjectsRoot()
		const sessionCache = yield* Ref.make(new Map<string, ProjectCacheEntry>())
		const allProjectsCache = yield* Ref.make(Option.none<AllProjectsCacheEntry>())

		const listSessionsForProject = (projectPath: TrimmedNonEmptyString) =>
			Effect.gen(function*() {
				const signature = yield* projectDirectorySignature(fs, path, projectsRoot, projectPath)
				const cache = yield* Ref.get(sessionCache)
				const cached = cache.get(projectPath)
				if (cached !== undefined && cached.signature === signature) {
					return cached.sessions
				}
				const sessions = yield* listClaudeSessionsForProject(fs, path, projectsRoot, projectPath)
				yield* Ref.update(
					sessionCache,
					(map) => new Map(map).set(projectPath, { signature, sessions })
				)
				return sessions
			})

		const listProjects = () =>
			Effect.gen(function*() {
				const signature = yield* rootDirectorySignature(fs, path, projectsRoot)
				const cached = yield* Ref.get(allProjectsCache)
				if (Option.isSome(cached) && cached.value.signature === signature) {
					return cached.value.projects
				}
				const projects = yield* listClaudeProjects(fs, path, projectsRoot)
				yield* Ref.set(allProjectsCache, Option.some({ signature, projects }))
				return projects
			})

		const shape: ProviderSessionDiscoveryShape = { listSessionsForProject, listProjects }
		return shape
	})
)
