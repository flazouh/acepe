import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import type { SessionReviewState } from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";

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
			const status = reviewState[revisionKey]?.status;
			return [file.filePath, status] as const;
		})
	);
}
