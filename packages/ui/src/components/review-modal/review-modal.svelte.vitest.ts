import { cleanup, fireEvent, render } from "@testing-library/svelte"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module")
	const { dirname, join } = await import("node:path")
	const require = createRequire(import.meta.url)
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	)

	return import(/* @vite-ignore */ svelteClientPath)
})

vi.mock("@pierre/diffs", () => {
	class FileDiff {
		render() {
			return undefined
		}
		cleanUp() {
			return undefined
		}
	}
	return {
		FileDiff,
		parseDiffFromFile: () => ({}),
	}
})

import ReviewModal from "./review-modal.svelte"
import type { ReviewModalViewModel } from "./review-modal-state.js"

afterEach(() => {
	cleanup()
})

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
			newContent: "alpha\nbeta\ngamma\n",
			hunks: [
				{ index: 0, action: "accepted" },
				{ index: 1, action: null },
				{ index: 2, action: "rejected" },
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

describe("ReviewModal", () => {
	it("shows status, blame, accepted hunk without buttons, and hides rejected hunks", () => {
		const onClose = vi.fn()
		const onSelectFile = vi.fn()
		const onAcceptHunk = vi.fn()
		const onRejectHunk = vi.fn()
		const view = render(ReviewModal, {
			props: {
				model,
				onClose,
				onSelectFile,
				onAcceptHunk,
				onRejectHunk,
			},
		})

		expect(view.getByTestId("git-review-modal")).toBeTruthy()
		expect(view.getByTestId("git-status-list")).toBeTruthy()
		expect(view.getByTestId("git-blame-list")).toBeTruthy()
		expect(view.getByTestId("git-hunk-0")).toBeTruthy()
		expect(view.queryByTestId("git-hunk-accept-0")).toBeNull()
		expect(view.getByTestId("git-hunk-accept-1")).toBeTruthy()
		expect(view.queryByTestId("git-hunk-2")).toBeNull()
		fireEvent.click(view.getByTestId("git-hunk-reject-1"))
		expect(onRejectHunk).toHaveBeenCalledWith("notes.md", 1)
	})

	it("renders the unavailable status copy when status is null", () => {
		const view = render(ReviewModal, {
			props: {
				model: {
					title: model.title,
					closeLabel: model.closeLabel,
					statusHeading: model.statusHeading,
					statusUnavailableLabel: model.statusUnavailableLabel,
					filesHeading: model.filesHeading,
					blameHeading: model.blameHeading,
					acceptLabel: model.acceptLabel,
					rejectLabel: model.rejectLabel,
					emptyFilesLabel: model.emptyFilesLabel,
					status: null,
					files: [],
					selectedPath: null,
				},
				onClose: vi.fn(),
				onSelectFile: vi.fn(),
				onAcceptHunk: vi.fn(),
				onRejectHunk: vi.fn(),
			},
		})
		expect(view.getByTestId("git-status-unavailable").textContent).toBe(
			"Git status is not available.",
		)
	})
})
