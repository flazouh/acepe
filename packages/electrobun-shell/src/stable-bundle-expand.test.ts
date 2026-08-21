import { expect, test } from "bun:test"

import {
	expandStableMacAppIfNeeded,
	findZstFile,
	findZigZstdPath,
	distDirNames,
	stableBundleNeedsExpand,
} from "./stable-bundle-expand.ts"

test("findZstFile picks the inner compressed tarball from Resources", () => {
	expect(findZstFile(["AppIcon.icns", "abc123.tar.zst", "version.json"])).toBe("abc123.tar.zst")
	expect(findZstFile(["AppIcon.icns", "version.json"])).toBeNull()
})

test("findZigZstdPath uses the platform dist folder under electrobun", () => {
	expect(distDirNames(["dist", "dist-macos-arm64", "src"])).toEqual(["dist-macos-arm64"])
	expect(
		findZigZstdPath(
			"/node_modules/electrobun",
			["dist-macos-arm64"],
			(path) => path === "/node_modules/electrobun/dist-macos-arm64/zig-zstd",
		),
	).toBe("/node_modules/electrobun/dist-macos-arm64/zig-zstd")
})

test("stable bundle needs expand when the wrapper has a zst and no native wrapper", () => {
	expect(
		stableBundleNeedsExpand({
			macosDirHasNativeWrapper: false,
			resourcesHasZst: true,
		}),
	).toBe(true)
})

test("stable bundle does not expand when the real launcher is already in place", () => {
	expect(
		stableBundleNeedsExpand({
			macosDirHasNativeWrapper: true,
			resourcesHasZst: true,
		}),
	).toBe(false)
})

test("expandStableMacAppIfNeeded replaces the extractor app with the inner Acepe.app", () => {
	const calls: Array<string> = []
	const result = expandStableMacAppIfNeeded({
		appPath: "/tmp/Acepe.app",
		extractDir: "/tmp/expand",
		macosDirHasNativeWrapper: false,
		findZst: () => "/tmp/Acepe.app/Contents/Resources/abc.tar.zst",
		decompressZst: (zst, tar) => {
			calls.push(`decompress:${zst}->${tar}`)
		},
		extractTar: (tar, dest) => {
			calls.push(`extract:${tar}->${dest}`)
		},
		replaceAppBundle: (from, to) => {
			calls.push(`replace:${from}->${to}`)
		},
		innerAppPath: (extractDir) => `${extractDir}/Acepe.app`,
	})
	expect(result).toBe("expanded")
	expect(calls[0]).toBe(
		"decompress:/tmp/Acepe.app/Contents/Resources/abc.tar.zst->/tmp/expand/bundle.tar",
	)
	expect(calls[1]).toBe("extract:/tmp/expand/bundle.tar->/tmp/expand")
	expect(calls[2]).toBe("replace:/tmp/expand/Acepe.app->/tmp/Acepe.app")
})

test("expandStableMacAppIfNeeded is a no-op when the native wrapper is present", () => {
	const result = expandStableMacAppIfNeeded({
		appPath: "/tmp/Acepe.app",
		extractDir: "/tmp/expand",
		macosDirHasNativeWrapper: true,
		findZst: () => "/tmp/Acepe.app/Contents/Resources/abc.tar.zst",
		decompressZst: () => {
			throw new Error("should not decompress")
		},
		extractTar: () => {
			throw new Error("should not extract")
		},
		replaceAppBundle: () => {
			throw new Error("should not replace")
		},
		innerAppPath: () => "/tmp/expand/Acepe.app",
	})
	expect(result).toBe("already-native")
})

test("expandStableMacAppIfNeeded fails loud when the wrapper has no tarball", () => {
	expect(() =>
		expandStableMacAppIfNeeded({
			appPath: "/tmp/Acepe.app",
			extractDir: "/tmp/expand",
			macosDirHasNativeWrapper: false,
			findZst: () => null,
			decompressZst: () => undefined,
			extractTar: () => undefined,
			replaceAppBundle: () => undefined,
			innerAppPath: () => "/tmp/expand/Acepe.app",
		}),
	).toThrow("acepe-shell-startup-failed: stable bundle has no inner tar.zst")
})
