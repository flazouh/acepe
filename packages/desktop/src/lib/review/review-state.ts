import {
	parseUnifiedHunks,
	type ProjectedGitReview,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import type { ReviewModalViewModel } from "@acepe/ui/review-modal";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";

export const REVIEW_MODAL_COPY = {
	title: "Review changes",
	closeLabel: "Close",
	statusHeading: "Status",
	statusUnavailableLabel: "Git status is not available.",
	filesHeading: "Files",
	blameHeading: "Blame",
	acceptLabel: "Accept",
	rejectLabel: "Reject",
	emptyFilesLabel: "Select a changed file",
	openLabel: "Review changes",
} as const;

export const selectedProjectWorkspaceRoot = (
	snapshot: RpcSessionSnapshot,
	projectId: string | null,
): string | null => {
	if (projectId === null) {
		return null
	}
	return Option.match(
		Arr.findFirst(snapshot.projects, (project) => project.projectId === projectId),
		{
			onNone: () => null,
			onSome: (project) => project.workspaceRoot,
		},
	)
}

export const gitReviewSnapshotIsNewer = (
	appliedSequence: number,
	nextSequence: number,
): boolean => nextSequence >= appliedSequence

export const gitReviewFileIsReady = (
	review: ProjectedGitReview | null,
	filePath: string,
): boolean => {
	if (review === null) {
		return false
	}
	return Option.match(
		Arr.findFirst(review.files, (file) => file.path === filePath),
		{
			onNone: () => false,
			onSome: (file) => file.diff !== null && file.patch !== "",
		},
	)
}

export const resolvedReviewPath = (input: {
	readonly gitReview: ProjectedGitReview | null
	readonly selectedPath: string | null
}): string | null => {
	if (input.selectedPath !== null) {
		return input.selectedPath
	}
	if (input.gitReview === null) {
		return null
	}
	const fromStatus = input.gitReview.status?.[0]?.path
	if (fromStatus !== undefined) {
		return fromStatus
	}
	return input.gitReview.files[0]?.path ?? null
}

export const reviewModalViewModel = (input: {
	readonly gitReview: ProjectedGitReview | null
	readonly selectedPath: string | null
}): ReviewModalViewModel => {
	const files =
		input.gitReview === null
			? []
			: Arr.map(input.gitReview.files, (file) => {
					const hunks = parseUnifiedHunks(file.patch)
					return {
						path: file.path,
						fileName: file.diff?.fileName ?? file.path,
						oldContent: file.diff?.oldContent ?? null,
						newContent: file.diff?.newContent ?? "",
						hunks: Arr.map(hunks, (hunk) => ({
							index: hunk.index,
							action:
								Option.match(
									Arr.findFirst(
										file.hunkDecisions,
										(decision) => decision.hunkIndex === hunk.index,
									),
									{
										onNone: () => null,
										onSome: (decision) => decision.action,
									},
								),
						})),
						blame: Arr.map(file.blame, (row) => ({
							line: row.line,
							commit: row.commit,
							author: row.author,
							summary: row.summary,
						})),
					}
				})
	return {
		title: REVIEW_MODAL_COPY.title,
		closeLabel: REVIEW_MODAL_COPY.closeLabel,
		statusHeading: REVIEW_MODAL_COPY.statusHeading,
		statusUnavailableLabel: REVIEW_MODAL_COPY.statusUnavailableLabel,
		filesHeading: REVIEW_MODAL_COPY.filesHeading,
		blameHeading: REVIEW_MODAL_COPY.blameHeading,
		acceptLabel: REVIEW_MODAL_COPY.acceptLabel,
		rejectLabel: REVIEW_MODAL_COPY.rejectLabel,
		emptyFilesLabel: REVIEW_MODAL_COPY.emptyFilesLabel,
		status: input.gitReview === null ? null : input.gitReview.status,
		files,
		selectedPath: resolvedReviewPath(input),
	}
}
