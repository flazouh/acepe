import { describe, expect, it } from "bun:test"

import {
	hunkButtonsVisible,
	hunkIsVisible,
	selectedReviewFile,
	type ReviewModalViewModel,
} from "./review-modal-state.js"

const model: ReviewModalViewModel = {
	title: "Review changes",
	closeLabel: "Close",
	statusHeading: "Status",
	statusUnavailableLabel: "Git status is not available.",
	filesHeading: "Files",
	blameHeading: "Blame",
	acceptLabel: "Accept",
	rejectLabel: "Reject",
	emptyFilesLabel: "Select a file",
	status: [
		{
			path: "notes.md",
			status: "M",
			insertions: 2,
			deletions: 2,
		},
	],
	files: [
		{
			path: "notes.md",
			fileName: "notes.md",
			oldContent: "alpha\n",
			newContent: "alpha\nbeta\n",
			hunks: [
				{ index: 0, action: "accepted" },
				{ index: 1, action: "rejected" },
				{ index: 2, action: null },
			],
			blame: [
				{
					line: 1,
					commit: "abc1234",
					author: "Test User",
					summary: "Seed",
				},
			],
		},
	],
	selectedPath: "notes.md",
}

describe("selectedReviewFile", () => {
	it("returns the file matching selectedPath", () => {
		expect(selectedReviewFile(model)?.path).toBe("notes.md")
		expect(
			selectedReviewFile({
				title: model.title,
				closeLabel: model.closeLabel,
				statusHeading: model.statusHeading,
				statusUnavailableLabel: model.statusUnavailableLabel,
				filesHeading: model.filesHeading,
				blameHeading: model.blameHeading,
				acceptLabel: model.acceptLabel,
				rejectLabel: model.rejectLabel,
				emptyFilesLabel: model.emptyFilesLabel,
				status: model.status,
				files: model.files,
				selectedPath: null,
			}),
		).toBeNull()
	})
})

describe("hunk visibility", () => {
	it("hides rejected hunks and drops buttons after accept", () => {
		expect(hunkIsVisible({ index: 0, action: "accepted" })).toBe(true)
		expect(hunkIsVisible({ index: 1, action: "rejected" })).toBe(false)
		expect(hunkButtonsVisible({ index: 0, action: "accepted" })).toBe(false)
		expect(hunkButtonsVisible({ index: 2, action: null })).toBe(true)
	})
})
