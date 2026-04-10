import { type FileContents, parseDiffFromFile } from "@pierre/diffs";

import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import {
	type PersistedFileReviewProgress,
	type PersistedResolvedHunkAction,
	toPersistedFileReviewProgress,
} from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";

export type KeepAllReviewEntry = {
	readonly revisionKey: string;
	readonly progress: PersistedFileReviewProgress;
};

function createDiffFileContents(name: string, contents: string, cacheKey: string): FileContents {
	return {
		name,
		contents,
		cacheKey,
	};
}

function buildAcceptedResolvedActions(totalHunks: number): PersistedResolvedHunkAction[] {
	const resolvedActions: PersistedResolvedHunkAction[] = [];

	for (let hunkIndex = 0; hunkIndex < totalHunks; hunkIndex++) {
		resolvedActions.push({
			hunkIndex,
			action: "accept",
		});
	}

	return resolvedActions;
}

function buildAcceptedReviewProgress(file: ModifiedFileEntry): PersistedFileReviewProgress {
	const originalContent = file.originalContent !== null ? file.originalContent : "";
	const finalContent = file.finalContent !== null ? file.finalContent : "";
	const oldFile = createDiffFileContents(
		file.fileName,
		originalContent,
		`keep-all:${file.filePath}:old`
	);
	const newFile = createDiffFileContents(
		file.fileName,
		finalContent,
		`keep-all:${file.filePath}:new`
	);
	const fileDiffMetadata = parseDiffFromFile(oldFile, newFile);
	const totalHunks = fileDiffMetadata.hunks.length;
	const resolvedActions = buildAcceptedResolvedActions(totalHunks);

	return toPersistedFileReviewProgress({
		filePath: file.filePath,
		status: "accepted",
		acceptedHunks: totalHunks,
		rejectedHunks: 0,
		pendingHunks: 0,
		totalHunks,
		resolvedActions,
	});
}

export function buildKeepAllReviewEntries(
	files: ReadonlyArray<ModifiedFileEntry>
): KeepAllReviewEntry[] {
	const reviewEntries: KeepAllReviewEntry[] = [];

	for (const file of files) {
		reviewEntries.push({
			revisionKey: createReviewFileRevisionKey(file),
			progress: buildAcceptedReviewProgress(file),
		});
	}

	return reviewEntries;
}
