import * as Arr from "effect/Array"
import * as Order from "effect/Order"

export type UnifiedHunk = {
	readonly index: number
	readonly oldStart: number
	readonly oldCount: number
	readonly newStart: number
	readonly newCount: number
	readonly oldLines: ReadonlyArray<string>
	readonly newLines: ReadonlyArray<string>
}

const HUNK_HEADER =
	/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

const splitLines = (
	content: string,
): { readonly lines: ReadonlyArray<string>; readonly endedWithNewline: boolean } => {
	if (content === "") {
		return { lines: [], endedWithNewline: false }
	}
	const endedWithNewline = content.endsWith("\n")
	const body = endedWithNewline ? content.slice(0, content.length - 1) : content
	return { lines: body.split("\n"), endedWithNewline }
}

const joinLines = (
	lines: ReadonlyArray<string>,
	endedWithNewline: boolean,
): string => {
	if (lines.length === 0) {
		return endedWithNewline ? "\n" : ""
	}
	const joined = lines.join("\n")
	if (endedWithNewline) {
		return `${joined}\n`
	}
	return joined
}

const parseCount = (value: string | undefined): number => {
	if (value === undefined) {
		return 1
	}
	return Number.parseInt(value, 10)
}

const replaceRange = (
	lines: ReadonlyArray<string>,
	startIndex: number,
	count: number,
	replacement: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	Arr.appendAll(
		Arr.appendAll(Arr.take(lines, startIndex), replacement),
		Arr.drop(lines, startIndex + count),
	)

export const parseUnifiedHunks = (patch: string): ReadonlyArray<UnifiedHunk> => {
	const lines = patch.split("\n")
	let hunks: Array<UnifiedHunk> = []
	let index = 0
	let cursor = 0
	while (cursor < lines.length) {
		const line = lines[cursor]
		if (line === undefined) {
			break
		}
		const match = HUNK_HEADER.exec(line)
		if (match === null) {
			cursor += 1
			continue
		}
		const oldStart = Number.parseInt(match[1] ?? "0", 10)
		const oldCount = parseCount(match[2])
		const newStart = Number.parseInt(match[3] ?? "0", 10)
		const newCount = parseCount(match[4])
		cursor += 1
		const oldLines: Array<string> = []
		const newLines: Array<string> = []
		let oldSeen = 0
		let newSeen = 0
		while (cursor < lines.length && (oldSeen < oldCount || newSeen < newCount)) {
			const body = lines[cursor]
			if (body === undefined) {
				break
			}
			if (HUNK_HEADER.test(body)) {
				break
			}
			if (body.startsWith("\\")) {
				cursor += 1
				continue
			}
			if (body.startsWith("+")) {
				newLines.push(body.slice(1))
				newSeen += 1
				cursor += 1
				continue
			}
			if (body.startsWith("-")) {
				oldLines.push(body.slice(1))
				oldSeen += 1
				cursor += 1
				continue
			}
			if (body.startsWith(" ") || body === "") {
				const text = body.startsWith(" ") ? body.slice(1) : body
				oldLines.push(text)
				newLines.push(text)
				oldSeen += 1
				newSeen += 1
				cursor += 1
				continue
			}
			cursor += 1
		}
		hunks = Arr.append(hunks, {
			index,
			oldStart,
			oldCount,
			newStart,
			newCount,
			oldLines,
			newLines,
		})
		index += 1
	}
	return hunks
}

const applyOneHunkToOld = (
	lines: ReadonlyArray<string>,
	hunk: UnifiedHunk,
): ReadonlyArray<string> => {
	if (hunk.oldCount === 0) {
		const insertAt = hunk.oldStart === 0 ? 0 : hunk.oldStart
		return replaceRange(lines, insertAt, 0, hunk.newLines)
	}
	return replaceRange(lines, hunk.oldStart - 1, hunk.oldCount, hunk.newLines)
}

const revertOneHunkOnNew = (
	lines: ReadonlyArray<string>,
	hunk: UnifiedHunk,
): ReadonlyArray<string> => {
	if (hunk.newCount === 0) {
		const insertAt = hunk.newStart === 0 ? 0 : hunk.newStart
		return replaceRange(lines, insertAt, 0, hunk.oldLines)
	}
	return replaceRange(lines, hunk.newStart - 1, hunk.newCount, hunk.oldLines)
}

export const applyHunks = (oldContent: string, patch: string): string => {
	const parsed = splitLines(oldContent)
	const hunks = parseUnifiedHunks(patch)
	const ordered = Arr.sortWith(hunks, (hunk) => hunk.oldStart, Order.flip(Order.Number))
	let next = parsed.lines
	for (const hunk of ordered) {
		next = applyOneHunkToOld(next, hunk)
	}
	return joinLines(next, parsed.endedWithNewline)
}

export const revertHunkInContent = (
	newContent: string,
	patch: string,
	hunkIndex: number,
): string => revertHunksInContent(newContent, patch, [hunkIndex])

export const revertHunksInContent = (
	newContent: string,
	patch: string,
	hunkIndexes: ReadonlyArray<number>,
): string => {
	const parsed = splitLines(newContent)
	const hunks = parseUnifiedHunks(patch)
	const selected = Arr.filter(hunks, (hunk) => Arr.contains(hunkIndexes, hunk.index))
	const ordered = Arr.sortWith(selected, (hunk) => hunk.newStart, Order.flip(Order.Number))
	let next = parsed.lines
	for (const hunk of ordered) {
		next = revertOneHunkOnNew(next, hunk)
	}
	return joinLines(next, parsed.endedWithNewline)
}
