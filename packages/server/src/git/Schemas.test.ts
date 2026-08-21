import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import {
	CloneResult,
	FileDiffResult,
	FileGitStatus,
	GitPanelFileStatus,
	GitStackedAction,
	MergeStrategy,
	WorkingFileDiff
} from "./Schemas.ts"

const decodeFileGitStatus = Schema.decodeUnknownSync(FileGitStatus)
const decodePanelStatus = Schema.decodeUnknownSync(GitPanelFileStatus)
const decodeFileDiff = Schema.decodeUnknownSync(FileDiffResult)
const decodeWorkingDiff = Schema.decodeUnknownSync(WorkingFileDiff)
const decodeClone = Schema.decodeUnknownSync(CloneResult)
const isStackedAction = Schema.is(GitStackedAction)
const isMergeStrategy = Schema.is(MergeStrategy)

Vitest.describe("FileGitStatus", () => {
	Vitest.it("decodes the file-index status shape the UI already consumes", () => {
		const status = decodeFileGitStatus({
			path: "src/main.ts",
			status: "M",
			insertions: 4,
			deletions: 1
		})
		Vitest.assert.strictEqual(status.path, "src/main.ts")
		Vitest.assert.strictEqual(status.status, "M")
		Vitest.assert.strictEqual(status.insertions, 4)
		Vitest.assert.strictEqual(status.deletions, 1)
	})
})

Vitest.describe("GitPanelFileStatus", () => {
	Vitest.it("keeps null index and worktree statuses instead of omitting them", () => {
		const status = decodePanelStatus({
			path: "README.md",
			indexStatus: null,
			worktreeStatus: "modified",
			indexInsertions: 0,
			indexDeletions: 0,
			worktreeInsertions: 2,
			worktreeDeletions: 0
		})
		Vitest.assert.strictEqual(status.indexStatus, null)
		Vitest.assert.strictEqual(status.worktreeStatus, "modified")
	})
})

Vitest.describe("FileDiffResult", () => {
	Vitest.it("feeds pierre with oldContent, newContent, and fileName", () => {
		const diff = decodeFileDiff({
			oldContent: "a\n",
			newContent: "b\n",
			fileName: "note.txt"
		})
		Vitest.assert.strictEqual(diff.oldContent, "a\n")
		Vitest.assert.strictEqual(diff.newContent, "b\n")
		Vitest.assert.strictEqual(diff.fileName, "note.txt")
	})

	Vitest.it("uses null oldContent for a new file", () => {
		const diff = decodeFileDiff({
			oldContent: null,
			newContent: "hello\n",
			fileName: "new.txt"
		})
		Vitest.assert.strictEqual(diff.oldContent, null)
	})
})

Vitest.describe("WorkingFileDiff", () => {
	Vitest.it("keeps the git patch text for the review modal", () => {
		const diff = decodeWorkingDiff({
			path: "src/a.ts",
			status: "modified",
			additions: 1,
			deletions: 1,
			patch: "diff --git a/src/a.ts b/src/a.ts\n"
		})
		Vitest.assert.strictEqual(diff.patch.startsWith("diff --git"), true)
	})
})

Vitest.describe("CloneResult", () => {
	Vitest.it("stores the destination path and display name", () => {
		const result = decodeClone({
			path: "/tmp/my-project",
			name: "My Project"
		})
		Vitest.assert.strictEqual(result.name, "My Project")
	})
})

Vitest.describe("GitStackedAction", () => {
	Vitest.it("accepts the three UI stacked actions", () => {
		Vitest.assert.strictEqual(isStackedAction("commit"), true)
		Vitest.assert.strictEqual(isStackedAction("commit_push"), true)
		Vitest.assert.strictEqual(isStackedAction("commit_push_pr"), true)
		Vitest.assert.strictEqual(isStackedAction("rebase"), false)
	})
})

Vitest.describe("MergeStrategy", () => {
	Vitest.it("accepts squash, merge, and rebase", () => {
		Vitest.assert.strictEqual(isMergeStrategy("squash"), true)
		Vitest.assert.strictEqual(isMergeStrategy("merge"), true)
		Vitest.assert.strictEqual(isMergeStrategy("rebase"), true)
		Vitest.assert.strictEqual(isMergeStrategy("fast"), false)
	})
})
