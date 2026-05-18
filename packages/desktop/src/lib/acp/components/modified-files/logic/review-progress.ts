import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import type { SessionReviewState } from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";

function normalizeReviewStatus(
	progress: SessionReviewState["filesByRevisionKey"][string] | undefined
): FileReviewStatus | undefined {
	if (!progress) {
		return undefined;
	}

	if (progress.pendingHunks > 0) {
		return "partial";
	}

	if (progress.rejectedHunks > 0 || progress.status === "denied") {
		return "denied";
	}

	return "accepted";
}

/**
 * Resolve persisted review status per file path for the current modified-files snapshot.
 * A file is considered reviewed only when the persisted revision key matches the current snapshot.
 */
export function getReviewStatusByFilePath(
	files: ReadonlyArray<ModifiedFileEntry>,
	state: SessionReviewState | null
): ReadonlyMap<string, FileReviewStatus | undefined> {
	const reviewState = state?.filesByRevisionKey ?? {};

	return new Map(
		files.map((file) => {
			const revisionKey = createReviewFileRevisionKey(file);
			const status = normalizeReviewStatus(reviewState[revisionKey]);
			return [file.filePath, status] as const;
		})
	);
}

export function hasKeepAllBeenApplied(
	files: ReadonlyArray<ModifiedFileEntry>,
	state: SessionReviewState | null
): boolean {
	if (files.length === 0) {
		return false;
	}

	const statusByFilePath = getReviewStatusByFilePath(files, state);

	for (const file of files) {
		if (statusByFilePath.get(file.filePath) !== "accepted") {
			return false;
		}
	}

	return true;
}
