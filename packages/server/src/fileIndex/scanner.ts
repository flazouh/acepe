import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import type * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import type * as Schema from "effect/Schema"
import * as Str from "effect/String"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "./Errors.ts"
import {
	isGitignoreName,
	parseGitignore,
	posixDirname,
	toPosixPath,
	type GitignoreRule
} from "./gitignore.ts"
import { joinUnderRoot, listGitFiles } from "./listGitFiles.ts"
import { makeIndexedFile } from "./makeIndexedFile.ts"
import type { IndexedFile } from "./Schemas.ts"
import { walkProjectFiles } from "./walkProject.ts"

export type ScanProjectError =
	| FileIndexRootNotFoundError
	| FileIndexNotADirectoryError
	| PlatformError
	| Schema.SchemaError

export type ScanProjectResult = {
	readonly files: ReadonlyArray<IndexedFile>
	readonly ignoreRules: ReadonlyArray<GitignoreRule>
}

const emptyRules = (): ReadonlyArray<GitignoreRule> => Arr.empty()

const readIgnoreFile = Effect.fn("readIgnoreFile")(function*(
	fs: FileSystem.FileSystem,
	filePath: string,
	baseDir: string
) {
	const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false))
	if (exists === false) {
		return emptyRules()
	}
	const content = yield* fs.readFileString(filePath)
	return parseGitignore(content, baseDir)
})

const gitignoreNameOrder = Order.combine(
	Order.mapInput(Order.Number, (name: string) => toPosixPath(name).split("/").length),
	Str.Order
)

const loadIgnoreRules = Effect.fn("loadIgnoreRules")(function*(
	fs: FileSystem.FileSystem,
	pathApi: Path.Path,
	root: string,
	names: ReadonlyArray<string>,
	excludeRules: ReadonlyArray<GitignoreRule>
) {
	const gitignoreNames = Arr.sort(Arr.filter(names, isGitignoreName), gitignoreNameOrder)
	const nested = yield* Effect.forEach(gitignoreNames, (relative) =>
		readIgnoreFile(fs, joinUnderRoot(pathApi, root, relative), posixDirname(toPosixPath(relative)))
	)
	return Arr.appendAll(excludeRules, Arr.flatten(nested))
})

export const scanProject = Effect.fn("scanProject")(function*(
	fs: FileSystem.FileSystem,
	pathApi: Path.Path,
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
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
	const gitNames = yield* listGitFiles(spawner, projectPath)
	if (Option.isSome(gitNames)) {
		const ignoreRules = yield* loadIgnoreRules(fs, pathApi, projectPath, gitNames.value, emptyRules())
		return {
			files: Arr.map(gitNames.value, makeIndexedFile),
			ignoreRules
		} satisfies ScanProjectResult
	}
	const excludeRules = yield* readIgnoreFile(
		fs,
		pathApi.join(projectPath, ".git", "info", "exclude"),
		""
	)
	const walked = yield* walkProjectFiles(fs, pathApi, projectPath, excludeRules)
	return {
		files: walked.files,
		ignoreRules: Arr.appendAll(excludeRules, walked.ignoreRules)
	} satisfies ScanProjectResult
})
