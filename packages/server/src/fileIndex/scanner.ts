import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import type * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "./Errors.ts"
import {
	exceedsMaxScanDepth,
	extensionFromRelativePath,
	isGitInternalPath,
	isIgnoredPath,
	parseGitignore,
	posixDirname,
	toPosixPath,
	type GitignoreRule
} from "./gitignore.ts"
import { IndexedFile } from "./Schemas.ts"

const decodeRelativePath = Schema.decodeUnknownEffect(TrimmedNonEmptyString)
const decodeIndexedFile = Schema.decodeUnknownEffect(IndexedFile)

export type ScanProjectError =
	| FileIndexRootNotFoundError
	| FileIndexNotADirectoryError
	| PlatformError
	| Schema.SchemaError

export type ScanProjectResult = {
	readonly files: ReadonlyArray<IndexedFile>
	readonly ignoreRules: ReadonlyArray<GitignoreRule>
}

const isGitignoreName = (relativePath: string): boolean => {
	const posix = toPosixPath(relativePath)
	if (posix === ".gitignore") {
		return true
	}
	return posix.endsWith("/.gitignore") === true && isGitInternalPath(posix) === false
}

const directoryPrefixes = (names: ReadonlyArray<string>): HashSet.HashSet<string> =>
	Arr.reduce(names, HashSet.empty<string>(), (directories, name) => {
		const posix = toPosixPath(name)
		let rest = posix
		let next = directories
		while (true) {
			const index = rest.lastIndexOf("/")
			if (index === -1) {
				return next
			}
			rest = rest.slice(0, index)
			next = HashSet.add(next, rest)
		}
	})

export const indexedFileFromRelativePath = Effect.fn("indexedFileFromRelativePath")(function*(
	relativePath: string
) {
	const path = yield* decodeRelativePath(toPosixPath(relativePath))
	return yield* decodeIndexedFile({
		path,
		extension: extensionFromRelativePath(path),
		lineCount: 0,
		gitStatus: null
	})
})

const readIgnoreFile = Effect.fn("readIgnoreFile")(function*(
	fs: FileSystem.FileSystem,
	filePath: string,
	baseDir: string
) {
	const exists = yield* fs.exists(filePath)
	if (exists === false) {
		return Arr.empty<GitignoreRule>()
	}
	const content = yield* fs.readFileString(filePath)
	return parseGitignore(content, baseDir)
})

const loadIgnoreRules = Effect.fn("loadIgnoreRules")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	names: ReadonlyArray<string>
) {
	const excludeRules = yield* readIgnoreFile(
		fs,
		path.join(root, ".git", "info", "exclude"),
		""
	)
	const gitignoreNameOrder = Order.combine(
		Order.mapInput(Order.Number, (name: string) => toPosixPath(name).split("/").length),
		Str.Order
	)
	const gitignoreNames = Arr.sort(Arr.filter(names, isGitignoreName), gitignoreNameOrder)
	const nested = yield* Effect.forEach(gitignoreNames, (relative) => {
		const posix = toPosixPath(relative)
		return readIgnoreFile(fs, path.join(root, ...posix.split("/")), posixDirname(posix))
	})
	return Arr.appendAll(excludeRules, Arr.flatten(nested))
})

const shouldKeepFile = (
	relativePath: string,
	ignoreRules: ReadonlyArray<GitignoreRule>
): boolean => {
	if (isGitInternalPath(relativePath) === true) {
		return false
	}
	if (exceedsMaxScanDepth(relativePath) === true) {
		return false
	}
	if (isIgnoredPath(ignoreRules, relativePath) === true) {
		return false
	}
	return true
}

export const scanProject = Effect.fn("scanProject")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectPath: string
) {
	const exists = yield* fs.exists(projectPath)
	if (exists === false) {
		return yield* new FileIndexRootNotFoundError({ path: projectPath })
	}
	const info = yield* fs.stat(projectPath)
	if (info.type !== "Directory") {
		return yield* new FileIndexNotADirectoryError({ path: projectPath })
	}
	const listing = yield* fs.readDirectory(projectPath, { recursive: true })
	const names = Arr.map(listing, toPosixPath)
	const ignoreRules = yield* loadIgnoreRules(fs, path, projectPath, names)
	const directories = directoryPrefixes(names)
	const candidates = Arr.filter(
		names,
		(name) => HashSet.has(directories, name) === false && shouldKeepFile(name, ignoreRules)
	)
	const confirmed = yield* Effect.forEach(
		candidates,
		(name) =>
			Effect.gen(function*() {
				const absolute = path.join(projectPath, ...name.split("/"))
				const stat = yield* fs.stat(absolute)
				if (stat.type !== "File") {
					return Option.none()
				}
				const file = yield* indexedFileFromRelativePath(name)
				return Option.some(file)
			}),
		{ concurrency: 32 }
	)
	const files = Arr.getSomes(confirmed)
	return {
		files,
		ignoreRules
	} satisfies ScanProjectResult
})
