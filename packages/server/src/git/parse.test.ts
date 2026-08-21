import * as Vitest from "@effect/vitest"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import {
	capitalizeName,
	fileStatusChar,
	formatRelativeTime,
	isCloneUrl,
	lookupNumstat,
	parseAheadBehind,
	parseBlame,
	parseGitDiffFiles,
	parseLog,
	parseNumstat,
	parsePorcelain,
	parseShortstat,
	parseStashList,
	parseWorktreePorcelain,
	toFileGitStatus,
	toPanelStatus,
	truncateContext
} from "./parse.ts"

Vitest.describe("parsePorcelain", () => {
	Vitest.it("parses staged, unstaged, untracked, and renamed paths", () => {
		const entries = parsePorcelain(
			["M  src/a.ts", " M src/b.ts", "?? new.txt", "R  old.txt -> new-name.txt", ""].join("\n")
		)
		Vitest.assert.strictEqual(entries.length, 4)
		Vitest.assert.strictEqual(entries[0]?.indexChar, "M")
		Vitest.assert.strictEqual(entries[0]?.worktreeChar, " ")
		Vitest.assert.strictEqual(entries[1]?.worktreeChar, "M")
		Vitest.assert.strictEqual(entries[2]?.path, "new.txt")
		Vitest.assert.strictEqual(entries[3]?.path, "new-name.txt")
		Vitest.assert.strictEqual(Option.getOrUndefined(entries[3]?.origPath ?? Option.none()), "old.txt")
	})
})

Vitest.describe("fileStatusChar", () => {
	Vitest.it("matches the rust git2 status character rules", () => {
		Vitest.assert.strictEqual(fileStatusChar("A", " "), "A")
		Vitest.assert.strictEqual(fileStatusChar("?", "?"), "A")
		Vitest.assert.strictEqual(fileStatusChar(" ", "M"), "M")
		Vitest.assert.strictEqual(fileStatusChar("D", " "), "D")
		Vitest.assert.strictEqual(fileStatusChar("R", " "), "R")
		Vitest.assert.strictEqual(fileStatusChar("U", "U"), "U")
	})
})

Vitest.describe("parseNumstat", () => {
	Vitest.it("maps path to insertions and deletions, including renames", () => {
		const stats = parseNumstat("4\t1\tsrc/a.ts\n-\t-\tbin.dat\n2\t0\told.ts => new.ts\n")
		Vitest.assert.deepStrictEqual(lookupNumstat(stats, "src/a.ts"), {
			insertions: 4,
			deletions: 1
		})
		Vitest.assert.deepStrictEqual(lookupNumstat(stats, "bin.dat"), {
			insertions: 0,
			deletions: 0
		})
		Vitest.assert.deepStrictEqual(lookupNumstat(stats, "new.ts"), {
			insertions: 2,
			deletions: 0
		})
		Vitest.assert.deepStrictEqual(lookupNumstat(stats, "missing.ts"), {
			insertions: 0,
			deletions: 0
		})
	})
})

Vitest.describe("parseShortstat", () => {
	Vitest.it("parses git diff --shortstat text", () => {
		Vitest.assert.deepStrictEqual(
			parseShortstat("3 files changed, 10 insertions(+), 5 deletions(-)"),
			{
				files: 3,
				insertions: 10,
				deletions: 5
			}
		)
		Vitest.assert.deepStrictEqual(parseShortstat(""), {
			files: 0,
			insertions: 0,
			deletions: 0
		})
	})
})

Vitest.describe("toPanelStatus", () => {
	Vitest.it("splits index and worktree status and uses untracked numstat for new files", () => {
		const entries = parsePorcelain("?? hello.ts\n")
		const entry = entries[0]
		Vitest.assert.isDefined(entry)
		if (entry === undefined) {
			return
		}
		const status = toPanelStatus(
			entry,
			HashMap.empty(),
			HashMap.empty(),
			HashMap.make(["hello.ts", { insertions: 3, deletions: 0 }])
		)
		Vitest.assert.deepStrictEqual(Option.getOrUndefined(status), {
			path: "hello.ts",
			indexStatus: null,
			worktreeStatus: "untracked",
			indexInsertions: 0,
			indexDeletions: 0,
			worktreeInsertions: 3,
			worktreeDeletions: 0
		})
	})
})

Vitest.describe("toFileGitStatus", () => {
	Vitest.it("skips diff stats for untracked files", () => {
		const entries = parsePorcelain("?? hello.ts\n")
		const entry = entries[0]
		Vitest.assert.isDefined(entry)
		if (entry === undefined) {
			return
		}
		const status = toFileGitStatus(
			entry,
			HashMap.make(["hello.ts", { insertions: 9, deletions: 0 }]),
			true
		)
		Vitest.assert.strictEqual(status.status, "A")
		Vitest.assert.strictEqual(status.insertions, 0)
		Vitest.assert.strictEqual(status.deletions, 0)
	})

	Vitest.it("keeps diff stats for tracked modifications", () => {
		const entries = parsePorcelain(" M src/a.ts\n")
		const entry = entries[0]
		Vitest.assert.isDefined(entry)
		if (entry === undefined) {
			return
		}
		const status = toFileGitStatus(
			entry,
			HashMap.make(["src/a.ts", { insertions: 4, deletions: 1 }]),
			true
		)
		Vitest.assert.strictEqual(status.status, "M")
		Vitest.assert.strictEqual(status.insertions, 4)
		Vitest.assert.strictEqual(status.deletions, 1)
	})
})

Vitest.describe("parseLog", () => {
	Vitest.it("formats commit time relative to now", () => {
		const entries = parseLog("abc1234def\tabc1234\tFix bug\tAda\t1000\n", 1000 + 7200)
		Vitest.assert.strictEqual(entries.length, 1)
		Vitest.assert.strictEqual(entries[0]?.message, "Fix bug")
		Vitest.assert.strictEqual(entries[0]?.date, "2h ago")
		Vitest.assert.strictEqual(entries[0]?.shortSha, "abc1234")
	})
})

Vitest.describe("parseStashList", () => {
	Vitest.it("parses stash@{n} index, message, and date", () => {
		const entries = parseStashList("stash@{0}\tWIP on main\t2 hours ago\n")
		Vitest.assert.deepStrictEqual(entries, [
			{
				index: 0,
				message: "WIP on main",
				date: "2 hours ago"
			}
		])
	})
})

Vitest.describe("parseBlame", () => {
	Vitest.it("reads porcelain blame headers into per-line rows", () => {
		const output = [
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1",
			"author Ada",
			"summary First line",
			"filename note.txt",
			"\thello",
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2",
			"author Ada",
			"summary First line",
			"filename note.txt",
			"\tworld",
			""
		].join("\n")
		const rows = parseBlame(output)
		Vitest.assert.strictEqual(rows.length, 2)
		Vitest.assert.strictEqual(rows[0]?.line, 1)
		Vitest.assert.strictEqual(rows[0]?.author, "Ada")
		Vitest.assert.strictEqual(rows[1]?.line, 2)
		Vitest.assert.strictEqual(rows[1]?.commit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	})
})

Vitest.describe("parseAheadBehind", () => {
	Vitest.it("reads git rev-list left-right counts", () => {
		Vitest.assert.deepStrictEqual(parseAheadBehind("2\t5\n"), {
			ahead: 2,
			behind: 5
		})
	})
})

Vitest.describe("parseWorktreePorcelain", () => {
	Vitest.it("reads worktree path and branch from porcelain blocks", () => {
		const parsed = parseWorktreePorcelain(
			["worktree /tmp/repo", "HEAD abc", "branch refs/heads/main", "", "worktree /tmp/wt", "branch refs/heads/topic"].join(
				"\n"
			)
		)
		Vitest.assert.strictEqual(parsed.length, 2)
		Vitest.assert.strictEqual(parsed[0]?.directory, "/tmp/repo")
		Vitest.assert.strictEqual(Option.getOrUndefined(parsed[0]?.branch ?? Option.none()), "main")
		Vitest.assert.strictEqual(parsed[1]?.directory, "/tmp/wt")
	})
})

Vitest.describe("parseGitDiffFiles", () => {
	Vitest.it("keeps a unified patch that pierre can consume unchanged", () => {
		const diffText = [
			"diff --git a/src/a.ts b/src/a.ts",
			"index 111..222 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -1 +1 @@",
			"-old",
			"+new",
			""
		].join("\n")
		const files = parseGitDiffFiles(diffText)
		Vitest.assert.strictEqual(files.length, 1)
		Vitest.assert.strictEqual(files[0]?.path, "src/a.ts")
		Vitest.assert.strictEqual(files[0]?.status, "modified")
		Vitest.assert.strictEqual(files[0]?.patch.includes("@@ -1 +1 @@"), true)
		Vitest.assert.strictEqual(files[0]?.patch.includes("-old"), true)
	})

	Vitest.it("marks new files as added", () => {
		const diffText = [
			"diff --git a/new.txt b/new.txt",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/new.txt",
			"@@ -0,0 +1 @@",
			"+hello",
			""
		].join("\n")
		const files = parseGitDiffFiles(diffText)
		Vitest.assert.strictEqual(files[0]?.status, "added")
	})
})

Vitest.describe("formatRelativeTime", () => {
	Vitest.it("matches the rust git2 relative buckets", () => {
		Vitest.assert.strictEqual(formatRelativeTime(100, 90), "just now")
		Vitest.assert.strictEqual(formatRelativeTime(200, 100), "1m ago")
		Vitest.assert.strictEqual(formatRelativeTime(8000, 1000), "1h ago")
		Vitest.assert.strictEqual(formatRelativeTime(200000, 1000), "2d ago")
		Vitest.assert.strictEqual(formatRelativeTime(700000, 1000), "1w ago")
		Vitest.assert.strictEqual(formatRelativeTime(3000000, 1000), "1mo ago")
	})
})

Vitest.describe("capitalizeName", () => {
	Vitest.it("capitalizes hyphen and underscore clone directory names", () => {
		Vitest.assert.strictEqual(capitalizeName("my-project"), "My Project")
		Vitest.assert.strictEqual(capitalizeName("my_project"), "My Project")
		Vitest.assert.strictEqual(capitalizeName("myproject"), "Myproject")
		Vitest.assert.strictEqual(capitalizeName("MY-PROJECT"), "My Project")
	})
})

Vitest.describe("truncateContext", () => {
	Vitest.it("appends a truncated marker when the text is too long", () => {
		Vitest.assert.strictEqual(truncateContext("abcd", 4), "abcd")
		Vitest.assert.strictEqual(truncateContext("abcdef", 4), "abcd\n\n[truncated]")
	})
})

Vitest.describe("isCloneUrl", () => {
	Vitest.it("accepts http, https, and git@ URLs", () => {
		Vitest.assert.strictEqual(isCloneUrl("https://github.com/a/b.git"), true)
		Vitest.assert.strictEqual(isCloneUrl("http://example.com/r.git"), true)
		Vitest.assert.strictEqual(isCloneUrl("git@github.com:a/b.git"), true)
		Vitest.assert.strictEqual(isCloneUrl("ftp://x"), false)
	})
})
