import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import { CheckpointPathError } from "./Services/CheckpointService.ts"

const normalizeSeparators = (value: string): string => value.replaceAll("\\", "/")

const isUncPath = (value: string): boolean =>
	value.startsWith("\\\\") || value.startsWith("//")

const escapesBase = (relative: string): boolean =>
	relative === ".." || relative.startsWith("../") || relative.startsWith("..\\")

export const convertToRelativePath = Effect.fn("convertToRelativePath")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	absolutePath: string,
	projectPath: string,
	worktreePath: string | null
) {
	if (absolutePath === "") {
		return yield* new CheckpointPathError({
			path: absolutePath,
			reason: "Empty path provided"
		})
	}
	if (isUncPath(absolutePath)) {
		return yield* new CheckpointPathError({
			path: absolutePath,
			reason: `UNC paths not supported: ${absolutePath}`
		})
	}
	const abs = yield* fs.realPath(absolutePath).pipe(
		Effect.mapError(
			() =>
				new CheckpointPathError({
					path: absolutePath,
					reason: `Cannot access path '${absolutePath}'`
				})
		)
	)
	if (worktreePath !== null) {
		const worktreeReal = yield* fs.realPath(worktreePath).pipe(Effect.option)
		if (Option.isSome(worktreeReal) && abs.startsWith(worktreeReal.value)) {
			const relative = path.relative(worktreeReal.value, abs)
			if (relative === "" || path.isAbsolute(relative) || escapesBase(relative)) {
				return yield* new CheckpointPathError({
					path: absolutePath,
					reason: `Path '${absolutePath}' is outside project and worktree boundaries`
				})
			}
			return normalizeSeparators(relative)
		}
	}
	const projectReal = yield* fs.realPath(projectPath).pipe(
		Effect.mapError(
			() =>
				new CheckpointPathError({
					path: projectPath,
					reason: `Cannot access project directory '${projectPath}'`
				})
		)
	)
	if (abs.startsWith(projectReal) === false) {
		return yield* new CheckpointPathError({
			path: absolutePath,
			reason: `Path '${absolutePath}' is outside project and worktree boundaries`
		})
	}
	const relative = path.relative(projectReal, abs)
	if (relative === "" || path.isAbsolute(relative) || escapesBase(relative)) {
		return yield* new CheckpointPathError({
			path: absolutePath,
			reason: `Path '${absolutePath}' is outside project and worktree boundaries`
		})
	}
	return normalizeSeparators(relative)
})

export const validateRelativePath = Effect.fn("validateRelativePath")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectPath: string,
	relativePath: string
) {
	if (relativePath.includes("..")) {
		return yield* new CheckpointPathError({
			path: relativePath,
			reason: `Path contains invalid traversal pattern: ${relativePath}`
		})
	}
	if (path.isAbsolute(relativePath) || relativePath.startsWith("\\")) {
		return yield* new CheckpointPathError({
			path: relativePath,
			reason: `Relative path cannot be absolute: ${relativePath}`
		})
	}
	const projectReal = yield* fs.realPath(projectPath).pipe(
		Effect.mapError(
			() =>
				new CheckpointPathError({
					path: projectPath,
					reason: "Cannot access project directory"
				})
		)
	)
	const joined = path.join(projectReal, relativePath)
	const exists = yield* fs.exists(joined)
	if (exists) {
		const fullReal = yield* fs.realPath(joined).pipe(
			Effect.mapError(
				() =>
					new CheckpointPathError({
						path: relativePath,
						reason: `Cannot access file: ${relativePath}`
					})
			)
		)
		if (fullReal.startsWith(projectReal) === false) {
			return yield* new CheckpointPathError({
				path: relativePath,
				reason: `Path is outside project directory: ${relativePath}`
			})
		}
		return fullReal
	}
	const parent = path.dirname(joined)
	const parentExists = yield* fs.exists(parent)
	if (parentExists) {
		const parentReal = yield* fs.realPath(parent).pipe(
			Effect.mapError(
				() =>
					new CheckpointPathError({
						path: relativePath,
						reason: `Cannot access directory for: ${relativePath}`
					})
			)
		)
		const filename = path.basename(joined)
		const resolved = path.join(parentReal, filename)
		if (resolved.startsWith(projectReal) === false) {
			return yield* new CheckpointPathError({
				path: relativePath,
				reason: `Path is outside project directory: ${relativePath}`
			})
		}
		return resolved
	}
	const fallback = path.join(projectReal, relativePath)
	if (fallback.startsWith(projectReal) === false) {
		return yield* new CheckpointPathError({
			path: relativePath,
			reason: `Path is outside project directory: ${relativePath}`
		})
	}
	return fallback
})

export const toRelativeModifiedPath = Effect.fn("toRelativeModifiedPath")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	filePath: string,
	projectPath: string,
	worktreePath: string | null
) {
	if (path.isAbsolute(filePath) === false) {
		if (filePath.includes("..")) {
			return yield* new CheckpointPathError({
				path: filePath,
				reason: `Path contains invalid traversal pattern: ${filePath}`
			})
		}
		return normalizeSeparators(filePath)
	}
	return yield* convertToRelativePath(fs, path, filePath, projectPath, worktreePath)
})
