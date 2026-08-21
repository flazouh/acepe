import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { runCommandUsing, type RunCommandResult } from "../git/runGit.ts"
import { exceedsMaxScanDepth, isGitInternalPath, toPosixPath } from "./gitignore.ts"

export const FILE_INDEX_GIT_BIN = "git"

const LS_FILES_ARGS: ReadonlyArray<string> = [
	"ls-files",
	"-co",
	"--exclude-standard",
	"-z"
]

const EXCLUDE_PATH_ARGS: ReadonlyArray<string> = ["rev-parse", "--git-path", "info/exclude"]

const EXIT_OK_OR_NOT_A_REPO: ReadonlyArray<number> = [0, 128]

const failedGit: RunCommandResult = {
	stdout: "",
	stderr: "",
	exitCode: 128
}

const runGit = Effect.fn("listGitFiles.runGit")(function*(
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	projectPath: string,
	args: ReadonlyArray<string>
) {
	return yield* runCommandUsing(spawner, {
		bin: FILE_INDEX_GIT_BIN,
		args,
		cwd: projectPath,
		allowExitCodes: EXIT_OK_OR_NOT_A_REPO,
		env: Option.none()
	}).pipe(Effect.orElseSucceed(() => failedGit))
})

const keepListedPath = (name: string): boolean => {
	if (name.length === 0) {
		return false
	}
	if (isGitInternalPath(name) === true) {
		return false
	}
	if (exceedsMaxScanDepth(name) === true) {
		return false
	}
	return true
}

export const joinUnderRoot = (pathApi: Path.Path, root: string, relative: string): string => {
	const posix = toPosixPath(relative)
	if (posix.length === 0) {
		return root
	}
	let current = root
	const parts = posix.split("/")
	let index = 0
	while (index < parts.length) {
		const part = parts[index]
		index = index + 1
		if (part === undefined) {
			continue
		}
		if (part.length === 0) {
			continue
		}
		current = pathApi.join(current, part)
	}
	return current
}

export const resolveGitExcludePath = Effect.fn("resolveGitExcludePath")(function*(
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	pathApi: Path.Path,
	projectPath: string
) {
	const result = yield* runGit(spawner, projectPath, EXCLUDE_PATH_ARGS)
	if (result.exitCode !== 0) {
		return Option.none<string>()
	}
	const raw = result.stdout.trim()
	if (raw.length === 0) {
		return Option.none<string>()
	}
	if (pathApi.isAbsolute(raw) === true) {
		return Option.some(raw)
	}
	return Option.some(joinUnderRoot(pathApi, projectPath, raw))
})

export const listGitFiles = Effect.fn("listGitFiles")(function*(
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	projectPath: string
) {
	const result = yield* runGit(spawner, projectPath, LS_FILES_ARGS)
	if (result.exitCode !== 0) {
		return Option.none<ReadonlyArray<string>>()
	}
	const names = result.stdout.split("\0")
	return Option.some(Arr.filter(names, keepListedPath))
})
