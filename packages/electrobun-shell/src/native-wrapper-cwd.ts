import * as Result from "effect/Result"

import { ShellStartupError } from "./shell-startup-error.ts"

export const NATIVE_WRAPPER_FILENAMES = [
	"libNativeWrapper.dylib",
	"libNativeWrapper.dll",
	"libNativeWrapper.so",
] as const

export type NativeWrapperLookup = {
	readonly cwd: string
	readonly bunEntrypointDir: string
	readonly execPathDir: string
	readonly exists: (path: string) => boolean
}

export type NativeWrapperCwdHost = NativeWrapperLookup & {
	readonly chdir: (path: string) => void
}

const PATH_SPLIT = /[/\\]+/

export const joinPathSegments = (base: string, segments: ReadonlyArray<string>): string => {
	const isAbsolutePosix = base.startsWith("/")
	const parts = base.split(PATH_SPLIT).filter((part) => part.length > 0 && part !== ".")
	for (const segment of segments) {
		if (segment.length === 0 || segment === ".") {
			continue
		}
		if (segment === "..") {
			parts.pop()
			continue
		}
		parts.push(segment)
	}
	const joined = parts.join("/")
	if (isAbsolutePosix === true) {
		return `/${joined}`
	}
	return joined
}

const dirHasNativeWrapper = (dir: string, exists: (path: string) => boolean): boolean => {
	for (const name of NATIVE_WRAPPER_FILENAMES) {
		if (exists(`${dir}/${name}`) === true) {
			return true
		}
	}
	return false
}

export const nativeWrapperCandidateDirs = (input: {
	readonly cwd: string
	readonly bunEntrypointDir: string
	readonly execPathDir: string
}): ReadonlyArray<string> => [
	input.cwd,
	input.execPathDir,
	joinPathSegments(input.bunEntrypointDir, ["..", "..", "..", "MacOS"]),
	joinPathSegments(input.bunEntrypointDir, ["..", "..", "..", "bin"]),
]

export const nativeWrapperDirectory = (input: NativeWrapperLookup): string | null => {
	for (const dir of nativeWrapperCandidateDirs(input)) {
		if (dirHasNativeWrapper(dir, input.exists) === true) {
			return dir
		}
	}
	return null
}

export const applyNativeWrapperCwd = (
	host: NativeWrapperCwdHost,
): Result.Result<string, ShellStartupError> => {
	const dir = nativeWrapperDirectory(host)
	if (dir === null) {
		return Result.fail(
			new ShellStartupError({
				reason: "native wrapper library not found next to launcher",
			}),
		)
	}
	if (dir !== host.cwd) {
		host.chdir(dir)
	}
	return Result.succeed(dir)
}

export const applyNativeWrapperCwdOrExit = (
	host: NativeWrapperCwdHost & {
		readonly writeError: (line: string) => void
		readonly exit: (code: number) => never
	},
): string => {
	const applied = applyNativeWrapperCwd(host)
	if (Result.isFailure(applied) === true) {
		host.writeError(applied.failure.message)
		return host.exit(1)
	}
	return applied.success
}
