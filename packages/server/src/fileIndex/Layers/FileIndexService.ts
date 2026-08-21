import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type { GitignoreRule } from "../gitignore.ts"
import { FILE_INDEX_CACHE_TTL_MS, makeIndexCache } from "../indexCache.ts"
import { applyFileIndexUpdates, buildProjectIndex, emptyGitStatus } from "../incremental.ts"
import { scanProject } from "../scanner.ts"
import type { FileIndexUpdate, ProjectIndex } from "../Schemas.ts"
import { type FileIndexError, FileIndexService } from "../Services/FileIndexService.ts"

export type CachedProjectIndex = {
	readonly index: ProjectIndex
	readonly ignoreRules: ReadonlyArray<GitignoreRule>
}

const makeFileIndexService = Effect.fn("FileIndexService.make")(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const cache = yield* makeIndexCache<CachedProjectIndex, FileIndexError>(FILE_INDEX_CACHE_TTL_MS)

	const scan = Effect.fn("FileIndexService.scan")(function*(projectPath: string) {
		const scanned = yield* scanProject(fs, path, projectPath)
		return {
			index: yield* buildProjectIndex(projectPath, scanned.files, emptyGitStatus()),
			ignoreRules: scanned.ignoreRules
		} satisfies CachedProjectIndex
	})

	const getProjectIndex = Effect.fn("FileIndexService.getProjectIndex")(function*(
		projectPath: string
	) {
		const cached = yield* cache.getOrFetch(projectPath, scan(projectPath))
		return cached.index
	})

	const prewarm = Effect.fn("FileIndexService.prewarm")(function*(projectPath: string) {
		return yield* getProjectIndex(projectPath)
	})

	const applyUpdates = Effect.fn("FileIndexService.applyUpdates")(function*(
		projectPath: string,
		updates: ReadonlyArray<FileIndexUpdate>
	) {
		const peeked = yield* cache.peek(projectPath)
		const current = yield* Option.match(peeked, {
			onNone: () => cache.getOrFetch(projectPath, scan(projectPath)),
			onSome: (value) => Effect.succeed(value)
		})
		const nextIndex = yield* applyFileIndexUpdates(current.index, updates, current.ignoreRules)
		const next: CachedProjectIndex = {
			index: nextIndex,
			ignoreRules: current.ignoreRules
		}
		yield* cache.updateCached(projectPath, next)
		return nextIndex
	})

	const invalidate = Effect.fn("FileIndexService.invalidate")(function*(projectPath: string) {
		yield* cache.invalidate(projectPath)
	})

	return FileIndexService.of({
		getProjectIndex,
		prewarm,
		applyUpdates,
		invalidate
	})
})

export const FileIndexServiceLive = Layer.effect(FileIndexService, makeFileIndexService())
