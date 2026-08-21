export const MAX_SCAN_DEPTH = 50

export const toPosixPath = (value: string): string => value.split("\\").join("/")

export const posixBasename = (relativePath: string): string => {
	const posix = toPosixPath(relativePath)
	const index = posix.lastIndexOf("/")
	if (index === -1) {
		return posix
	}
	return posix.slice(index + 1)
}

export const posixDirname = (relativePath: string): string => {
	const posix = toPosixPath(relativePath)
	const index = posix.lastIndexOf("/")
	if (index === -1) {
		return ""
	}
	return posix.slice(0, index)
}

export const posixJoin = (baseDir: string, child: string): string => {
	if (baseDir.length === 0) {
		return toPosixPath(child)
	}
	if (child.length === 0) {
		return toPosixPath(baseDir)
	}
	return `${toPosixPath(baseDir)}/${toPosixPath(child)}`
}

export const isGitInternalPath = (relativePath: string): boolean => {
	const posix = toPosixPath(relativePath)
	const segments = posix.split("/")
	let index = 0
	while (index < segments.length) {
		if (segments[index] === ".git") {
			return true
		}
		index = index + 1
	}
	return false
}

export const scanDepth = (relativePath: string): number => {
	const posix = toPosixPath(relativePath)
	if (posix.length === 0) {
		return 0
	}
	return posix.split("/").length
}

export const exceedsMaxScanDepth = (relativePath: string): boolean =>
	scanDepth(relativePath) > MAX_SCAN_DEPTH

export const extensionFromRelativePath = (relativePath: string): string => {
	const base = posixBasename(relativePath)
	const dot = base.lastIndexOf(".")
	if (dot <= 0) {
		return ""
	}
	return base.slice(dot + 1)
}

const escapeRegex = (value: string): string =>
	value.replace(/[|\\{}()[\]^$+*?.]/gu, "\\$&")

const globToRegExp = (glob: string, unanchored: boolean): RegExp => {
	let source = "^"
	if (unanchored === true) {
		source = `${source}(?:.*/)?`
	}
	let index = 0
	while (index < glob.length) {
		const current = glob[index]
		const next = glob[index + 1]
		if (current === "*" && next === "*") {
			const after = glob[index + 2]
			if (after === "/") {
				source = `${source}(?:.*/)?`
				index = index + 3
				continue
			}
			source = `${source}.*`
			index = index + 2
			continue
		}
		if (current === "*") {
			source = `${source}[^/]*`
			index = index + 1
			continue
		}
		if (current === "?") {
			source = `${source}[^/]`
			index = index + 1
			continue
		}
		if (current === undefined) {
			break
		}
		source = `${source}${escapeRegex(current)}`
		index = index + 1
	}
	return new RegExp(`${source}$`, "u")
}

export type GitignoreRule = {
	readonly negated: boolean
	readonly directoryOnly: boolean
	readonly unanchored: boolean
	readonly pattern: string
	readonly matcher: RegExp
	readonly baseDir: string
}

const parseLine = (raw: string, baseDir: string): GitignoreRule | null => {
	const withoutComment = raw.trim()
	if (withoutComment.length === 0) {
		return null
	}
	if (withoutComment.startsWith("#") === true) {
		return null
	}
	if (withoutComment.length > 1_000) {
		return null
	}
	const negated = withoutComment.startsWith("!")
	const body = negated === true ? withoutComment.slice(1) : withoutComment
	const directoryOnly = body.endsWith("/")
	const withoutDir = directoryOnly === true ? body.slice(0, body.length - 1) : body
	const rooted = withoutDir.startsWith("/")
	const pattern = rooted === true ? withoutDir.slice(1) : withoutDir
	if (pattern.length === 0) {
		return null
	}
	const unanchored = rooted === false && pattern.includes("/") === false
	return {
		negated,
		directoryOnly,
		unanchored,
		pattern,
		matcher: globToRegExp(pattern, unanchored),
		baseDir: toPosixPath(baseDir)
	}
}

export const parseGitignore = (
	content: string,
	baseDir: string
): ReadonlyArray<GitignoreRule> => {
	const lines = content.split("\n")
	const rules: Array<GitignoreRule> = []
	let index = 0
	while (index < lines.length) {
		const line = lines[index]
		index = index + 1
		if (line === undefined) {
			continue
		}
		const rule = parseLine(line, baseDir)
		if (rule !== null) {
			rules.push(rule)
		}
	}
	return rules
}

const stripBaseDir = (relativePath: string, baseDir: string): string | null => {
	const posix = toPosixPath(relativePath)
	if (baseDir.length === 0) {
		return posix
	}
	if (posix === baseDir) {
		return ""
	}
	const prefix = `${baseDir}/`
	if (posix.startsWith(prefix) === false) {
		return null
	}
	return posix.slice(prefix.length)
}

const ancestorPaths = (relativePath: string): ReadonlyArray<string> => {
	const posix = toPosixPath(relativePath)
	if (posix.length === 0) {
		return []
	}
	const ancestors: Array<string> = []
	let rest = posix
	while (true) {
		const index = rest.lastIndexOf("/")
		if (index === -1) {
			return ancestors
		}
		rest = rest.slice(0, index)
		ancestors.push(rest)
	}
}

const ruleMatchesRelative = (rule: GitignoreRule, relativeToBase: string): boolean => {
	if (relativeToBase.length === 0) {
		return false
	}
	if (rule.matcher.test(relativeToBase) === true) {
		return true
	}
	if (rule.directoryOnly === false) {
		return false
	}
	if (relativeToBase === rule.pattern) {
		return true
	}
	if (rule.unanchored === true) {
		const segments = relativeToBase.split("/")
		let index = 0
		while (index < segments.length) {
			const segment = segments[index]
			if (segment === rule.pattern) {
				return true
			}
			if (segment !== undefined && rule.matcher.test(segment) === true) {
				return true
			}
			index = index + 1
		}
		return false
	}
	return relativeToBase.startsWith(`${rule.pattern}/`)
}

export const isIgnoredPath = (
	rules: ReadonlyArray<GitignoreRule>,
	relativePath: string
): boolean => {
	const posix = toPosixPath(relativePath)
	if (posix.length === 0) {
		return false
	}
	let ignored = false
	let index = 0
	while (index < rules.length) {
		const rule = rules[index]
		index = index + 1
		if (rule === undefined) {
			continue
		}
		const relativeToBase = stripBaseDir(posix, rule.baseDir)
		if (relativeToBase === null || relativeToBase.length === 0) {
			continue
		}
		if (ruleMatchesRelative(rule, relativeToBase) === true) {
			ignored = rule.negated === false
			continue
		}
		if (rule.directoryOnly === true) {
			const ancestors = ancestorPaths(relativeToBase)
			let ancestorIndex = 0
			while (ancestorIndex < ancestors.length) {
				const ancestor = ancestors[ancestorIndex]
				ancestorIndex = ancestorIndex + 1
				if (ancestor === undefined) {
					continue
				}
				if (ruleMatchesRelative(rule, ancestor) === true) {
					ignored = rule.negated === false
				}
			}
		}
	}
	return ignored
}
