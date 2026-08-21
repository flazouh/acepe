import * as HashSet from "effect/HashSet"

/**
 * Split text the way Rust `str::lines` does, so checkpoint diffs match
 * checkpoints written by the Tauri service.
 */
export const rustLines = (text: string): ReadonlyArray<string> => {
	if (text === "") {
		return []
	}
	const parts = text.split("\n")
	const withoutTrailing = text.endsWith("\n") ? parts.slice(0, parts.length - 1) : parts
	return withoutTrailing.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
}

export type DiffStats = {
	readonly linesAdded: number
	readonly linesRemoved: number
}

export const computeDiffStats = (oldContent: string | null, newContent: string): DiffStats => {
	if (oldContent === null) {
		return {
			linesAdded: rustLines(newContent).length,
			linesRemoved: 0
		}
	}
	const oldLines = HashSet.fromIterable(rustLines(oldContent))
	const newLines = HashSet.fromIterable(rustLines(newContent))
	return {
		linesAdded: HashSet.size(HashSet.difference(newLines, oldLines)),
		linesRemoved: HashSet.size(HashSet.difference(oldLines, newLines))
	}
}
