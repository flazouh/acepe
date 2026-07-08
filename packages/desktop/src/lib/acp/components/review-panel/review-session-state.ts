/**
 * Shared review session state helpers for the agent-panel review modal.
 * Tracks per-file review progress as a simple reviewed/unreviewed status.
 */

export type FileReviewStatus = "reviewed" | "unreviewed";

/**
 * Returns the next file whose status is not "reviewed", scanning forward from
 * the current index. Undefined entries are treated as unreviewed. Returns null
 * when every later file is already reviewed.
 */
export function nextUnreviewedFileIndex(
	currentIndex: number,
	fileStatuses: ReadonlyArray<FileReviewStatus | undefined>
): number | null {
	for (let i = currentIndex + 1; i < fileStatuses.length; i += 1) {
		if (fileStatuses[i] !== "reviewed") {
			return i;
		}
	}
	return null;
}

/**
 * Returns the immediate next file index, or null when current is the last file.
 */
export function nextSequentialFileIndex(currentIndex: number, totalFiles: number): number | null {
	if (totalFiles <= 0) return null;
	const nextIndex = currentIndex + 1;
	return nextIndex < totalFiles ? nextIndex : null;
}

/**
 * Returns the immediate previous file index, or null when current is the first file.
 */
export function prevSequentialFileIndex(currentIndex: number): number | null {
	const prevIndex = currentIndex - 1;
	return prevIndex >= 0 ? prevIndex : null;
}
