export type ReviewHunkAction = "accepted" | "rejected" | null

export type ReviewModalStatusRow = {
	readonly path: string
	readonly status: string
	readonly insertions: number
	readonly deletions: number
}

export type ReviewModalBlameRow = {
	readonly line: number
	readonly commit: string
	readonly author: string
	readonly summary: string
}

export type ReviewModalHunk = {
	readonly index: number
	readonly action: ReviewHunkAction
}

export type ReviewModalFile = {
	readonly path: string
	readonly fileName: string
	readonly oldContent: string | null
	readonly newContent: string
	readonly hunks: ReadonlyArray<ReviewModalHunk>
	readonly blame: ReadonlyArray<ReviewModalBlameRow>
}

export type ReviewModalViewModel = {
	readonly title: string
	readonly closeLabel: string
	readonly statusHeading: string
	readonly statusUnavailableLabel: string
	readonly filesHeading: string
	readonly blameHeading: string
	readonly acceptLabel: string
	readonly rejectLabel: string
	readonly emptyFilesLabel: string
	readonly status: ReadonlyArray<ReviewModalStatusRow> | null
	readonly files: ReadonlyArray<ReviewModalFile>
	readonly selectedPath: string | null
}

export const selectedReviewFile = (model: ReviewModalViewModel): ReviewModalFile | null => {
	if (model.selectedPath === null) {
		return null
	}
	return model.files.find((file) => file.path === model.selectedPath) ?? null
}

export const hunkIsVisible = (hunk: ReviewModalHunk): boolean => hunk.action !== "rejected"

export const hunkButtonsVisible = (hunk: ReviewModalHunk): boolean => hunk.action === null
