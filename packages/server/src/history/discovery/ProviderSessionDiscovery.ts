import type { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Ref from "effect/Ref"
import type * as Schema from "effect/Schema"
import * as Str from "effect/String"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { ProjectionSessions } from "../../persistence/Services/ProjectionSessions.ts"
import { claudeProjectsRoot } from "./Roots.ts"
import {
	listClaudeProjects,
	listClaudeSessionsForProject,
	projectDirectorySignature,
	rootDirectorySignature
} from "./Scan.ts"
import type { DiscoveredProject, DiscoveredSession, ScannedSession } from "./Types.ts"

/**
 * Read-time provider discovery (#249 batch 3): the service `history.ts` and
 * `acp.ts` both defer session-open hydration on. Backs the
 * `listProviderSessions`/`listProviderProjects` RPCs.
 */
export type ProviderSessionDiscoveryShape = {
	readonly listSessionsForProject: (
		projectPath: TrimmedNonEmptyString
	) => Effect.Effect<
		ReadonlyArray<DiscoveredSession>,
		PlatformError | SqlError | Schema.SchemaError
	>
	readonly listProjects: () => Effect.Effect<ReadonlyArray<DiscoveredProject>, PlatformError>
}

export class ProviderSessionDiscovery extends Context.Service<
	ProviderSessionDiscovery,
	ProviderSessionDiscoveryShape
>()("@acepe/server/history/discovery/ProviderSessionDiscovery") {}

type ProjectCacheEntry = {
	readonly signature: string
	// The origin join reads the event store, not the directory, so a scan
	// that is still valid on disk can still hold stale origins. Cache both
	// signatures and rebuild when either side moves.
	readonly knownSignature: string
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
		const projectionSessions = yield* ProjectionSessions
		// Resolved once at layer construction: HOME/CLAUDE_HOME do not change
		// while the server runs, and closing over the resolved root keeps
		// Config/Path out of every call's requirement and error channel.
		const projectsRoot = yield* claudeProjectsRoot()
		const sessionCache = yield* Ref.make(new Map<string, ProjectCacheEntry>())
		const allProjectsCache = yield* Ref.make(Option.none<AllProjectsCacheEntry>())

		// Acepe knows a discovered session under either identity:
		// `session_id` for one it created itself, `provider_session_id` for
		// one it adopted from the provider. Union both, because the scan
		// only ever has the provider's own id to match on.
		const knownSessionIds = Effect.fn("knownSessionIds")(function*() {
			const projected = yield* projectionSessions.list()
			const ids = new Set<string>()
			for (const session of projected) {
				ids.add(session.sessionId)
				if (session.providerSessionId !== null) {
					ids.add(session.providerSessionId)
				}
			}
			return ids
		})

		const withOrigin = (
			scanned: ReadonlyArray<ScannedSession>,
			known: ReadonlySet<string>
		): ReadonlyArray<DiscoveredSession> =>
			scanned.map((session) => ({
				...session,
				origin: known.has(session.id) ? ("acepe" as const) : ("external" as const)
			}))

		const listSessionsForProject = (projectPath: TrimmedNonEmptyString) =>
			Effect.gen(function*() {
				const signature = yield* projectDirectorySignature(fs, path, projectsRoot, projectPath)
				const known = yield* knownSessionIds()
				const knownSignature = Arr.join(Arr.sort([...known], Str.Order), ",")
				const cache = yield* Ref.get(sessionCache)
				const cached = cache.get(projectPath)
				if (
					cached !== undefined &&
					cached.signature === signature &&
					cached.knownSignature === knownSignature
				) {
					return cached.sessions
				}
				const scanned = yield* listClaudeSessionsForProject(fs, path, projectsRoot, projectPath)
				const sessions = withOrigin(scanned, known)
				yield* Ref.update(
					sessionCache,
					(map) => new Map(map).set(projectPath, { signature, knownSignature, sessions })
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
