import { expect, test } from "bun:test"
import * as Result from "effect/Result"

import {
	applyNativeWrapperCwd,
	applyNativeWrapperCwdOrExit,
	joinPathSegments,
	nativeWrapperDirectory,
	NATIVE_WRAPPER_FILENAMES,
} from "./native-wrapper-cwd.ts"
import { SHELL_STARTUP_FAILED_PREFIX } from "./shell-startup-error.ts"

const macosBunDir = "/tmp/Acepe.app/Contents/Resources/app/bun"
const macosLauncherDir = "/tmp/Acepe.app/Contents/MacOS"

test("joinPathSegments walks from the bun entry to Contents/MacOS", () => {
	expect(joinPathSegments(macosBunDir, ["..", "..", "..", "MacOS"])).toBe(macosLauncherDir)
})

test("native wrapper lookup uses cwd when the dylib is already there", () => {
	const dir = nativeWrapperDirectory({
		cwd: macosLauncherDir,
		bunEntrypointDir: macosBunDir,
		execPathDir: macosLauncherDir,
		exists: (path) => path === `${macosLauncherDir}/libNativeWrapper.dylib`,
	})
	expect(dir).toBe(macosLauncherDir)
})

test("native wrapper lookup uses the bun entry MacOS dir when cwd is elsewhere", () => {
	const dir = nativeWrapperDirectory({
		cwd: "/Users/alex/Documents/acepe-lanes/AC-054",
		bunEntrypointDir: macosBunDir,
		execPathDir: "/usr/bin",
		exists: (path) => path === `${macosLauncherDir}/libNativeWrapper.dylib`,
	})
	expect(dir).toBe(macosLauncherDir)
})

test("native wrapper lookup uses execPathDir when the worker was copied to tmp", () => {
	const dir = nativeWrapperDirectory({
		cwd: "/",
		bunEntrypointDir: "/var/folders/tmp",
		execPathDir: macosLauncherDir,
		exists: (path) => path === `${macosLauncherDir}/libNativeWrapper.dylib`,
	})
	expect(dir).toBe(macosLauncherDir)
})

test("native wrapper lookup uses bin on linux bundles", () => {
	const bunDir = "/opt/Acepe/Resources/app/bun"
	const binDir = "/opt/Acepe/bin"
	const dir = nativeWrapperDirectory({
		cwd: "/home/alex",
		bunEntrypointDir: bunDir,
		execPathDir: "/usr/bin",
		exists: (path) => path === `${binDir}/libNativeWrapper.so`,
	})
	expect(dir).toBe(binDir)
})

test("native wrapper lookup returns null when the library is missing", () => {
	const dir = nativeWrapperDirectory({
		cwd: "/",
		bunEntrypointDir: macosBunDir,
		execPathDir: macosLauncherDir,
		exists: () => false,
	})
	expect(dir).toBeNull()
	expect(NATIVE_WRAPPER_FILENAMES).toContain("libNativeWrapper.dylib")
})

test("applyNativeWrapperCwd chdirs when cwd is not the launcher dir", () => {
	const dirs: Array<string> = []
	const applied = applyNativeWrapperCwd({
		cwd: "/Users/alex",
		bunEntrypointDir: macosBunDir,
		execPathDir: macosLauncherDir,
		exists: (path) => path === `${macosLauncherDir}/libNativeWrapper.dylib`,
		chdir: (path) => {
			dirs.push(path)
		},
	})
	expect(Result.isSuccess(applied)).toBe(true)
	if (Result.isSuccess(applied)) {
		expect(applied.success).toBe(macosLauncherDir)
	}
	expect(dirs).toEqual([macosLauncherDir])
})

test("applyNativeWrapperCwd does not chdir when cwd already has the wrapper", () => {
	const dirs: Array<string> = []
	const applied = applyNativeWrapperCwd({
		cwd: macosLauncherDir,
		bunEntrypointDir: macosBunDir,
		execPathDir: macosLauncherDir,
		exists: (path) => path === `${macosLauncherDir}/libNativeWrapper.dylib`,
		chdir: (path) => {
			dirs.push(path)
		},
	})
	expect(Result.isSuccess(applied)).toBe(true)
	expect(dirs).toEqual([])
})

test("applyNativeWrapperCwd fails loud when the native wrapper is missing", () => {
	const applied = applyNativeWrapperCwd({
		cwd: "/",
		bunEntrypointDir: macosBunDir,
		execPathDir: macosLauncherDir,
		exists: () => false,
		chdir: () => undefined,
	})
	expect(Result.isFailure(applied)).toBe(true)
	if (Result.isFailure(applied)) {
		expect(applied.failure.message).toBe(
			`${SHELL_STARTUP_FAILED_PREFIX}: native wrapper library not found next to launcher`,
		)
	}
})

test("applyNativeWrapperCwdOrExit writes the tagged error and exits 1", () => {
	const lines: Array<string> = []
	expect(() =>
		applyNativeWrapperCwdOrExit({
			cwd: "/",
			bunEntrypointDir: macosBunDir,
			execPathDir: macosLauncherDir,
			exists: () => false,
			chdir: () => undefined,
			writeError: (line) => {
				lines.push(line)
			},
			exit: (code) => {
				throw new Error(`exit-${String(code)}`)
			},
		}),
	).toThrow("exit-1")
	expect(lines).toEqual([
		`${SHELL_STARTUP_FAILED_PREFIX}: native wrapper library not found next to launcher`,
	])
})
