import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import {
	exceedsMaxScanDepth,
	isGitInternalPath,
	isIgnoredPath,
	parseGitignore,
	posixJoin,
	toPosixPath,
	type GitignoreRule
} from "./gitignore.ts"
import { makeIndexedFile } from "./makeIndexedFile.ts"
import type { IndexedFile } from "./Schemas.ts"

export type WalkProjectResult = {
	readonly files: ReadonlyArray<IndexedFile>
	readonly ignoreRules: ReadonlyArray<GitignoreRule>
}

const emptyWalk: WalkProjectResult = {
	files: Arr.empty(),
	ignoreRules: Arr.empty()
}

const visit = (
	fs: FileSystem.FileSystem,
	pathApi: Path.Path,
	abs: string,
	rel: string,
	depth: number,
	rules: ReadonlyArray<GitignoreRule>
): Effect.Effect<WalkProjectResult, PlatformError> =>
	Effect.gen(function*() {
		if (depth > 50) {
			return emptyWalk
		}
		const names = yield* fs.readDirectory(abs)
		const hasGitignore = Arr.contains(names, ".gitignore")
		const localRules =
			hasGitignore === true
				? parseGitignore(yield* fs.readFileString(pathApi.join(abs, ".gitignore")), rel)
				: Arr.empty<GitignoreRule>()
		const nextRules = Arr.appendAll(rules, localRules)
		const nested = yield* Effect.forEach(
			names,
			(name) =>
				Effect.gen(function*() {
					const childRel = posixJoin(rel, toPosixPath(name))
					if (isGitInternalPath(childRel) === true) {
						return emptyWalk
					}
					if (exceedsMaxScanDepth(childRel) === true) {
						return emptyWalk
					}
					if (isIgnoredPath(nextRules, childRel) === true) {
						return emptyWalk
					}
					const childAbs = pathApi.join(abs, name)
					const info = yield* fs.stat(childAbs).pipe(Effect.option)
					if (Option.isNone(info)) {
						return emptyWalk
					}
					if (info.value.type === "Directory") {
						return yield* visit(fs, pathApi, childAbs, childRel, depth + 1, nextRules)
					}
					if (info.value.type === "File") {
						return {
							files: Arr.of(makeIndexedFile(childRel)),
							ignoreRules: Arr.empty()
						} satisfies WalkProjectResult
					}
					return emptyWalk
				}),
			{ concurrency: 16 }
		)
		return {
			files: Arr.flatMap(nested, (entry) => entry.files),
			ignoreRules: Arr.appendAll(localRules, Arr.flatMap(nested, (entry) => entry.ignoreRules))
		} satisfies WalkProjectResult
	})

export const walkProjectFiles = Effect.fn("walkProjectFiles")(function*(
	fs: FileSystem.FileSystem,
	pathApi: Path.Path,
	projectPath: string,
	rootRules: ReadonlyArray<GitignoreRule>
) {
	return yield* visit(fs, pathApi, projectPath, "", 0, rootRules)
})
