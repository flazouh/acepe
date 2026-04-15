/**
 * Shared review session state for both review panel and agent panel review content.
 * Tracks per-file review progress as UI-session state (not persisted).
 */

export type FileReviewStatus = "accepted" | "partial" | "denied";

export type FileReviewCounters = {
	readonly acceptedHunks: number;
	readonly rejectedHunks: number;
	readonly pendingHunks: number;
	readonly totalHunks: number;
};

export type PerFileReviewState = FileReviewCounters & {
	readonly status: FileReviewStatus;
	readonly filePath: string;
};

/**
 * Computes FileReviewStatus from per-file counters.
 * - accepted: all hunks accepted, none rejected, not denied
 * - denied: used only when Reject file was clicked (handled at call site)
 * - partial: has pending hunks or mixed accepted/rejected
 */
export function computeFileReviewStatus(
	counters: FileReviewCounters,
	isDenied: boolean
): FileReviewStatus {
	if (isDenied) return "denied";
	if (counters.pendingHunks === 0 && counters.rejectedHunks === 0) return "accepted";
	return "partial";
}

/**
 * Whether the file still has pending hunks to review.
 */
export function isPendingFile(state: PerFileReviewState): boolean {
	return state.pendingHunks > 0 && state.status !== "denied";
}

/**
 * Index of the next file with pending hunks, or null if none.
 * @param currentIndex - Current selected file index
 * @param fileStates - Per-file review states in file order
 */
export function nextPendingFileIndex(
	currentIndex: number,
	fileStates: ReadonlyArray<PerFileReviewState | undefined>
): number | null {
	for (let i = currentIndex + 1; i < fileStates.length; i++) {
		const state = fileStates[i];
		if (state && isPendingFile(state)) return i;
	}
	return null;
}

/**
 * Index of the previous file with pending hunks, or null if none.
 */
export function prevPendingFileIndex(
	currentIndex: number,
	fileStates: ReadonlyArray<PerFileReviewState | undefined>
): number | null {
	for (let i = currentIndex - 1; i >= 0; i--) {
		const state = fileStates[i];
		if (state && isPendingFile(state)) return i;
	}
	return null;
}

/**
 * Whether to show the "Review next file" CTA.
 * Shown when current file was just accepted and there is a next pending file.
 */
export function shouldShowReviewNextFileCta(
	currentFileAccepted: boolean,
	hasNextPendingFile: boolean
): boolean {
	return currentFileAccepted && hasNextPendingFile;
}

/**
 * Whether a file has just been fully resolved (no pending hunks left).
 * Used to auto-advance review focus to the next file.
 */
export function shouldAutoAdvanceAfterFileResolution(counters: FileReviewCounters): boolean {
	return counters.totalHunks > 0 && counters.pendingHunks === 0;
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
