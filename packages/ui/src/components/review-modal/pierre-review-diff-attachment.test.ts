import { describe, expect, it } from "bun:test"

import { pierreReviewDiffKey, pierreReviewFileContents } from "./pierre-review-diff-attachment.js"

describe("pierreReviewFileContents", () => {
	it("passes oldContent, newContent, and fileName through unchanged", () => {
		const files = pierreReviewFileContents({
			oldContent: "alpha\n",
			newContent: "alpha\nbeta\n",
			fileName: "notes.md",
		})
		expect(files.oldFile).toEqual({
			name: "notes.md",
			contents: "alpha\n",
		})
		expect(files.newFile).toEqual({
			name: "notes.md",
			contents: "alpha\nbeta\n",
		})
	})

	it("uses empty contents when the old file is missing", () => {
		const files = pierreReviewFileContents({
			oldContent: null,
			newContent: "new\n",
			fileName: "created.ts",
		})
		expect(files.oldFile.contents).toBe("")
		expect(files.newFile.contents).toBe("new\n")
	})

	it("keys pierre re-render on file contents, not hunk actions", () => {
		expect(
			pierreReviewDiffKey({
				oldContent: "alpha\n",
				newContent: "alpha\nbeta\n",
				fileName: "notes.md",
			}),
		).toBe(
			pierreReviewDiffKey({
				oldContent: "alpha\n",
				newContent: "alpha\nbeta\n",
				fileName: "notes.md",
			}),
		)
		expect(
			pierreReviewDiffKey({
				oldContent: "alpha\n",
				newContent: "alpha\nbeta\n",
				fileName: "notes.md",
			}),
		).not.toBe(
			pierreReviewDiffKey({
				oldContent: "alpha\n",
				newContent: "alpha\nECHO\n",
				fileName: "notes.md",
			}),
		)
	})
})
