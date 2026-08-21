import * as Arr from "effect/Array"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import type { FileGitStatus, GitBlameLine, GitLogEntry, GitPanelFileStatus, GitStashEntry } from "./Schemas.ts"

export type Numstat = {
	readonly insertions: number
	readonly deletions: number
}

export type PorcelainEntry = {
	readonly indexChar: string
	readonly worktreeChar: string
	readonly path: string
	readonly origPath: Option.Option<string>
}

const indexStatusFromChar = (char: string): string | null => {
	if (char === "A") {
		return "added"
	}
	if (char === "M") {
		return "modified"
	}
	if (char === "D") {
		return "deleted"
	}
	if (char === "R") {
		return "renamed"
	}
	if (char === "C") {
		return "added"
	}
	return null
}

const worktreeStatusFromChar = (char: string): string | null => {
	if (char === "?") {
		return "untracked"
	}
	if (char === "M") {
		return "modified"
	}
	if (char === "D") {
		return "deleted"
	}
	if (char === "R") {
		return "renamed"
	}
	return null
}

export const fileStatusChar = (indexChar: string, worktreeChar: string): string => {
	if (indexChar === "A" || worktreeChar === "?" || worktreeChar === "A") {
		return "A"
	}
	if (indexChar === "M" || worktreeChar === "M") {
		return "M"
	}
	if (indexChar === "D" || worktreeChar === "D") {
		return "D"
	}
	if (indexChar === "R" || worktreeChar === "R") {
		return "R"
	}
	if (indexChar === "U" || worktreeChar === "U") {
		return "U"
	}
	return "?"
}

const splitRename = (pathField: string): { readonly path: string; readonly origPath: Option.Option<string> } => {
	const marker = " -> "
	const index = pathField.indexOf(marker)
	if (index < 0) {
		return {
			path: pathField,
			origPath: Option.none()
		}
	}
	return {
		path: pathField.slice(index + marker.length),
		origPath: Option.some(pathField.slice(0, index))
	}
}

export const parsePorcelain = (output: string): ReadonlyArray<PorcelainEntry> => {
	const lines = Arr.filter(output.split("\n"), (line) => line !== "")
	return Arr.filterMap(
		lines,
		Filter.fromPredicateOption((line) => {
			if (line.length < 4) {
				return Option.none()
			}
			const indexChar = line.slice(0, 1)
			const worktreeChar = line.slice(1, 2)
			const pathField = line.slice(3)
			if (pathField === "") {
				return Option.none()
			}
			const renamed = splitRename(pathField)
			return Option.some({
				indexChar,
				worktreeChar,
				path: renamed.path,
				origPath: renamed.origPath
			})
		})
	)
}

export const parseNumstat = (output: string): HashMap.HashMap<string, Numstat> => {
	const lines = Arr.filter(output.split("\n"), (line) => line !== "")
	return Arr.reduce(lines, HashMap.empty<string, Numstat>(), (acc, line) => {
		const parts = line.split("\t")
		const insertionsRaw = parts[0]
		const deletionsRaw = parts[1]
		const pathRaw = parts[2]
		if (insertionsRaw === undefined || deletionsRaw === undefined || pathRaw === undefined) {
			return acc
		}
		const path = numstatPath(pathRaw)
		const insertions = Number.parseInt(insertionsRaw, 10)
		const deletions = Number.parseInt(deletionsRaw, 10)
		return HashMap.set(acc, path, {
			insertions: Number.isNaN(insertions) ? 0 : insertions,
			deletions: Number.isNaN(deletions) ? 0 : deletions
		})
	})
}

const numstatPath = (raw: string): string => {
	const marker = " => "
	const index = raw.indexOf(marker)
	if (index < 0) {
		return raw
	}
	return raw.slice(index + marker.length)
}

export const lookupNumstat = (
	stats: HashMap.HashMap<string, Numstat>,
	path: string
): Numstat =>
	Option.getOrElse(HashMap.get(stats, path), () => ({
		insertions: 0,
		deletions: 0
	}))

export const parseShortstat = (output: string): { readonly files: number; readonly insertions: number; readonly deletions: number } => {
	const trimmed = output.trim()
	if (trimmed === "") {
		return {
			files: 0,
			insertions: 0,
			deletions: 0
		}
	}
	return Arr.reduce(trimmed.split(","), { files: 0, insertions: 0, deletions: 0 }, (acc, part) => {
		const token = part.trim()
		const numRaw = token.split(" ")[0]
		if (numRaw === undefined) {
			return acc
		}
		const num = Number.parseInt(numRaw, 10)
		if (Number.isNaN(num)) {
			return acc
		}
		if (token.includes("file")) {
			return {
				files: num,
				insertions: acc.insertions,
				deletions: acc.deletions
			}
		}
		if (token.includes("insertion")) {
			return {
				files: acc.files,
				insertions: num,
				deletions: acc.deletions
			}
		}
		if (token.includes("deletion")) {
			return {
				files: acc.files,
				insertions: acc.insertions,
				deletions: num
			}
		}
		return acc
	})
}

export const toPanelStatus = (
	entry: PorcelainEntry,
	indexStats: HashMap.HashMap<string, Numstat>,
	worktreeStats: HashMap.HashMap<string, Numstat>,
	untrackedStats: HashMap.HashMap<string, Numstat>
): Option.Option<GitPanelFileStatus> => {
	const indexStatus = indexStatusFromChar(entry.indexChar)
	const worktreeStatus = worktreeStatusFromChar(entry.worktreeChar)
	if (indexStatus === null && worktreeStatus === null) {
		return Option.none()
	}
	const index = lookupNumstat(indexStats, entry.path)
	const worktree =
		worktreeStatus === "untracked"
			? lookupNumstat(untrackedStats, entry.path)
			: lookupNumstat(worktreeStats, entry.path)
	return Option.some({
		path: entry.path,
		indexStatus,
		worktreeStatus,
		indexInsertions: index.insertions,
		indexDeletions: index.deletions,
		worktreeInsertions: worktree.insertions,
		worktreeDeletions: worktree.deletions
	})
}

export const toFileGitStatus = (
	entry: PorcelainEntry,
	stats: HashMap.HashMap<string, Numstat>,
	includeDiffStats: boolean
): FileGitStatus => {
	const counted =
		includeDiffStats === true &&
		entry.worktreeChar !== "?" &&
		entry.indexChar !== "A" &&
		entry.worktreeChar !== "A" &&
		entry.path.endsWith("/") === false
	const numstat = counted === true ? lookupNumstat(stats, entry.path) : { insertions: 0, deletions: 0 }
	return {
		path: entry.path,
		status: fileStatusChar(entry.indexChar, entry.worktreeChar),
		insertions: numstat.insertions,
		deletions: numstat.deletions
	}
}

export const parseLog = (output: string, nowSeconds: number): ReadonlyArray<GitLogEntry> => {
	const lines = Arr.filter(output.split("\n"), (line) => line !== "")
	return Arr.filterMap(
		lines,
		Filter.fromPredicateOption((line) => {
			const parts = line.split("\t")
			const sha = parts[0]
			const shortSha = parts[1]
			const message = parts[2]
			const author = parts[3]
			const timestampRaw = parts[4]
			if (
				sha === undefined ||
				shortSha === undefined ||
				message === undefined ||
				author === undefined ||
				timestampRaw === undefined
			) {
				return Option.none()
			}
			const thenSeconds = Number.parseInt(timestampRaw, 10)
			if (Number.isNaN(thenSeconds)) {
				return Option.none()
			}
			return Option.some({
				sha,
				shortSha,
				message,
				author,
				date: formatRelativeTime(nowSeconds, thenSeconds)
			})
		})
	)
}

export const parseStashList = (output: string): ReadonlyArray<GitStashEntry> => {
	const lines = Arr.filter(output.split("\n"), (line) => line !== "")
	return Arr.filterMap(
		lines,
		Filter.fromPredicateOption((line) => {
			const parts = line.split("\t")
			const ref = parts[0]
			const message = parts[1]
			const date = parts[2]
			if (ref === undefined || message === undefined || date === undefined) {
				return Option.none()
			}
			const indexRaw = ref.replace("stash@{", "").replace("}", "")
			const index = Number.parseInt(indexRaw, 10)
			if (Number.isNaN(index)) {
				return Option.none()
			}
			return Option.some({
				index,
				message,
				date
			})
		})
	)
}

export const parseBlame = (output: string): ReadonlyArray<GitBlameLine> => {
	const lines = output.split("\n")
	let commit = ""
	let author = ""
	let summary = ""
	let lineNumber = 0
	let acc: ReadonlyArray<GitBlameLine> = Arr.empty()
	for (const line of lines) {
		if (line.startsWith("author ")) {
			author = line.slice("author ".length)
			continue
		}
		if (line.startsWith("summary ")) {
			summary = line.slice("summary ".length)
			continue
		}
		if (line.startsWith("\t")) {
			if (lineNumber > 0 && commit !== "") {
				acc = Arr.append(acc, {
					line: lineNumber,
					commit,
					author,
					summary
				})
			}
			continue
		}
		const header = line.split(" ")
		const headerCommit = header[0]
		const headerLine = header[2]
		if (headerCommit !== undefined && headerCommit.length === 40 && headerLine !== undefined) {
			commit = headerCommit
			const parsed = Number.parseInt(headerLine, 10)
			if (Number.isNaN(parsed) === false) {
				lineNumber = parsed
			}
		}
	}
	return acc
}

export const parseAheadBehind = (
	output: string
): { readonly ahead: number; readonly behind: number } => {
	const trimmed = output.trim()
	const parts = trimmed.split(/\s+/)
	const aheadRaw = parts[0]
	const behindRaw = parts[1]
	const ahead = aheadRaw === undefined ? 0 : Number.parseInt(aheadRaw, 10)
	const behind = behindRaw === undefined ? 0 : Number.parseInt(behindRaw, 10)
	return {
		ahead: Number.isNaN(ahead) ? 0 : ahead,
		behind: Number.isNaN(behind) ? 0 : behind
	}
}

export const parseWorktreePorcelain = (
	output: string
): ReadonlyArray<{ readonly directory: string; readonly branch: Option.Option<string>; readonly bare: boolean }> => {
	const blocks = output.split("\n\n")
	return Arr.filterMap(
		blocks,
		Filter.fromPredicateOption((block) => {
			const lines = Arr.filter(block.split("\n"), (line) => line !== "")
			if (Arr.isReadonlyArrayNonEmpty(lines) === false) {
				return Option.none()
			}
			let directory = ""
			let branch: Option.Option<string> = Option.none()
			let bare = false
			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					directory = line.slice("worktree ".length)
				}
				if (line.startsWith("branch ")) {
					const ref = line.slice("branch ".length)
					branch = Option.some(ref.replace("refs/heads/", ""))
				}
				if (line === "bare") {
					bare = true
				}
			}
			if (directory === "") {
				return Option.none()
			}
			return Option.some({
				directory,
				branch,
				bare
			})
		})
	)
}

export const parseGitDiffFiles = (
	diffText: string
): ReadonlyArray<{ readonly path: string; readonly status: string; readonly patch: string }> => {
	const lines = diffText.split("\n")
	let currentPath = ""
	let currentStatus = "modified"
	let patch = ""
	let inPatch = false
	let acc: ReadonlyArray<{ readonly path: string; readonly status: string; readonly patch: string }> =
		Arr.empty()
	const pushCurrent = (): void => {
		if (currentPath === "") {
			return
		}
		acc = Arr.append(acc, {
			path: currentPath,
			status: currentStatus,
			patch: patch.trim()
		})
	}
	for (const line of lines) {
		if (line.startsWith("diff --git")) {
			pushCurrent()
			const parts = line.split(" ")
			const bPath = parts[3]
			currentPath = bPath === undefined ? "" : bPath.startsWith("b/") ? bPath.slice(2) : bPath
			currentStatus = "modified"
			patch = ""
			inPatch = true
			continue
		}
		if (inPatch === false) {
			continue
		}
		if (line.startsWith("new file mode")) {
			currentStatus = "added"
			continue
		}
		if (line.startsWith("deleted file mode")) {
			currentStatus = "deleted"
			continue
		}
		if (line.startsWith("similarity index") || line.startsWith("rename from")) {
			currentStatus = "renamed"
			continue
		}
		if (
			line.startsWith("@@") ||
			line.startsWith("---") ||
			line.startsWith("+++") ||
			(line.startsWith("index ") === false && line !== "" && patch !== "")
		) {
			patch = `${patch}${line}\n`
		}
	}
	pushCurrent()
	if (acc.length === 0 && diffText !== "") {
		return Arr.of({
			path: "changes",
			status: "modified",
			patch: diffText
		})
	}
	return acc
}

export const formatRelativeTime = (nowSeconds: number, thenSeconds: number): string => {
	const diff = nowSeconds - thenSeconds
	if (diff < 60) {
		return "just now"
	}
	if (diff < 3600) {
		return `${String(Math.floor(diff / 60))}m ago`
	}
	if (diff < 86400) {
		return `${String(Math.floor(diff / 3600))}h ago`
	}
	if (diff < 604800) {
		return `${String(Math.floor(diff / 86400))}d ago`
	}
	if (diff < 2592000) {
		return `${String(Math.floor(diff / 604800))}w ago`
	}
	return `${String(Math.floor(diff / 2592000))}mo ago`
}

export const capitalizeName = (name: string): string => {
	const words = name.split(/[ _-]/)
	return Arr.join(
		Arr.map(words, (word) => {
			const first = word.slice(0, 1)
			const rest = word.slice(1)
			if (first === "") {
				return ""
			}
			return `${first.toUpperCase()}${rest.toLowerCase()}`
		}),
		" "
	)
}

export const truncateContext = (value: string, maxBytes: number): string => {
	if (value.length <= maxBytes) {
		return value
	}
	return `${value.slice(0, maxBytes)}\n\n[truncated]`
}

export const isCloneUrl = (url: string): boolean =>
	url.startsWith("https://") === true || url.startsWith("http://") === true || url.startsWith("git@") === true
