import * as Vitest from "@effect/vitest"
import {
	exceedsMaxScanDepth,
	extensionFromRelativePath,
	isGitInternalPath,
	isIgnoredPath,
	MAX_SCAN_DEPTH,
	parseGitignore,
	posixBasename,
	posixDirname,
	posixJoin,
	toPosixPath
} from "./gitignore.ts"

Vitest.describe("path helpers", () => {
	Vitest.it("normalizes backslashes to posix", () => {
		Vitest.assert.strictEqual(toPosixPath("src\\file.ts"), "src/file.ts")
	})

	Vitest.it("splits basename and dirname", () => {
		Vitest.assert.strictEqual(posixBasename("src/lib/main.ts"), "main.ts")
		Vitest.assert.strictEqual(posixDirname("src/lib/main.ts"), "src/lib")
		Vitest.assert.strictEqual(posixDirname("main.ts"), "")
		Vitest.assert.strictEqual(posixJoin("src", "main.ts"), "src/main.ts")
		Vitest.assert.strictEqual(posixJoin("", "main.ts"), "main.ts")
	})

	Vitest.it("treats .git components as internal", () => {
		Vitest.assert.strictEqual(isGitInternalPath(".git/config"), true)
		Vitest.assert.strictEqual(isGitInternalPath("src/.git/hooks/pre-commit"), true)
		Vitest.assert.strictEqual(isGitInternalPath("src/main.ts"), false)
	})

	Vitest.it("rejects paths deeper than the walker max", () => {
		const segments: Array<string> = []
		let index = 0
		while (index < MAX_SCAN_DEPTH + 1) {
			segments.push("d")
			index = index + 1
		}
		Vitest.assert.strictEqual(exceedsMaxScanDepth(segments.join("/")), true)
		Vitest.assert.strictEqual(exceedsMaxScanDepth("src/main.ts"), false)
	})

	Vitest.it("reads an extension the same way Rust Path::extension does", () => {
		Vitest.assert.strictEqual(extensionFromRelativePath("src/main.ts"), "ts")
		Vitest.assert.strictEqual(extensionFromRelativePath(".gitignore"), "")
		Vitest.assert.strictEqual(extensionFromRelativePath("Makefile"), "")
		Vitest.assert.strictEqual(extensionFromRelativePath(".eslintrc.js"), "js")
	})
})

Vitest.describe("parseGitignore", () => {
	Vitest.it("skips comments, blanks, and oversized lines", () => {
		const huge = `x${"a".repeat(1_001)}`
		const rules = parseGitignore(`# keep\n\nignored.txt\n${huge}\n`, "")
		Vitest.assert.strictEqual(rules.length, 1)
		Vitest.assert.strictEqual(rules[0]?.pattern, "ignored.txt")
	})
})

Vitest.describe("isIgnoredPath", () => {
	Vitest.it("ignores a basename listed in the root gitignore", () => {
		const rules = parseGitignore("ignored.txt\n", "")
		Vitest.assert.strictEqual(isIgnoredPath(rules, "ignored.txt"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "nested/ignored.txt"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "included.ts"), false)
	})

	Vitest.it("keeps a file that a later negation un-ignores", () => {
		const rules = parseGitignore("*.log\n!keep.log\n", "")
		Vitest.assert.strictEqual(isIgnoredPath(rules, "debug.log"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "keep.log"), false)
	})

	Vitest.it("ignores files under a directory pattern", () => {
		const rules = parseGitignore("build/\n", "")
		Vitest.assert.strictEqual(isIgnoredPath(rules, "build/out.js"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "src/build/out.js"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "src/main.ts"), false)
	})

	Vitest.it("applies nested gitignore files only under their directory", () => {
		const rules = parseGitignore("dist/\n", "pkg")
		Vitest.assert.strictEqual(isIgnoredPath(rules, "pkg/dist/out.js"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "dist/out.js"), false)
	})

	Vitest.it("anchors a leading-slash pattern to the gitignore directory", () => {
		const rules = parseGitignore("/secret.txt\n", "")
		Vitest.assert.strictEqual(isIgnoredPath(rules, "secret.txt"), true)
		Vitest.assert.strictEqual(isIgnoredPath(rules, "nested/secret.txt"), false)
	})
})
