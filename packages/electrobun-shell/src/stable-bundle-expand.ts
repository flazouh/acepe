import { ShellStartupError } from "./shell-startup-error.ts"

export const INNER_TAR_NAME = "bundle.tar"

export const stableBundleNeedsExpand = (input: {
	readonly macosDirHasNativeWrapper: boolean
	readonly resourcesHasZst: boolean
}): boolean => input.macosDirHasNativeWrapper === false && input.resourcesHasZst === true

export const findZstFile = (files: ReadonlyArray<string>): string | null => {
	for (const file of files) {
		if (file.endsWith(".tar.zst") === true) {
			return file
		}
	}
	return null
}

export const distDirNames = (entries: ReadonlyArray<string>): ReadonlyArray<string> => {
	const dirs: Array<string> = []
	for (const entry of entries) {
		if (entry.startsWith("dist-") === true) {
			dirs.push(entry)
		}
	}
	return dirs
}

export const findZigZstdPath = (
	electrobunDir: string,
	distDirs: ReadonlyArray<string>,
	exists: (path: string) => boolean,
): string | null => {
	for (const distDir of distDirs) {
		const candidate = `${electrobunDir}/${distDir}/zig-zstd`
		if (exists(candidate) === true) {
			return candidate
		}
	}
	return null
}

export type ExpandStableMacAppInput = {
	readonly appPath: string
	readonly extractDir: string
	readonly macosDirHasNativeWrapper: boolean
	readonly findZst: () => string | null
	readonly decompressZst: (zst: string, tar: string) => void
	readonly extractTar: (tar: string, dest: string) => void
	readonly replaceAppBundle: (from: string, to: string) => void
	readonly innerAppPath: (extractDir: string) => string
}

export const expandStableMacAppIfNeeded = (
	input: ExpandStableMacAppInput,
): "expanded" | "already-native" => {
	if (input.macosDirHasNativeWrapper === true) {
		return "already-native"
	}
	const zst = input.findZst()
	if (zst === null) {
		throw new ShellStartupError({ reason: "stable bundle has no inner tar.zst" })
	}
	const tar = `${input.extractDir}/${INNER_TAR_NAME}`
	input.decompressZst(zst, tar)
	input.extractTar(tar, input.extractDir)
	input.replaceAppBundle(input.innerAppPath(input.extractDir), input.appPath)
	return "expanded"
}
