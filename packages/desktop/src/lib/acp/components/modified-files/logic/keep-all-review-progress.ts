import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import {
	type PersistedFileReviewProgress,
	toPersistedFileReviewProgress,
} from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";

export type KeepAllReviewEntry = {
	readonly revisionKey: string;
	readonly progress: PersistedFileReviewProgress;
};

function buildReviewedReviewProgress(file: ModifiedFileEntry): PersistedFileReviewProgress {
	return toPersistedFileReviewProgress({
		filePath: file.filePath,
		reviewed: true,
	});
}

export function buildKeepAllReviewEntries(
	files: ReadonlyArray<ModifiedFileEntry>
): KeepAllReviewEntry[] {
	const reviewEntries: KeepAllReviewEntry[] = [];

	for (const file of files) {
		reviewEntries.push({
			revisionKey: createReviewFileRevisionKey(file),
			progress: buildReviewedReviewProgress(file),
		});
	}

	return reviewEntries;
}
