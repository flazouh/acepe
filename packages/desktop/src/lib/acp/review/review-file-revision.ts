import type { ModifiedFileEntry } from "../types/modified-file-entry.js";

type ReviewFileSnapshot = Pick<
	ModifiedFileEntry,
	"filePath" | "editCount" | "totalAdded" | "totalRemoved" | "originalContent" | "finalContent"
>;

/**
 * Stable key for a reviewable file revision.
 * Changes when file path or aggregated content snapshot changes.
 */
export function createReviewFileRevisionKey(file: ReviewFileSnapshot): string {
	return [
		file.filePath,
		String(file.editCount),
		String(file.totalAdded),
		String(file.totalRemoved),
		file.originalContent ?? "",
		file.finalContent ?? "",
	].join("\u0000");
}

/**
 * True when two file snapshots represent the same review revision.
 */
export function areReviewFileSnapshotsEqual(
	previous: ReviewFileSnapshot,
	current: ReviewFileSnapshot
): boolean {
	return createReviewFileRevisionKey(previous) === createReviewFileRevisionKey(current);
}
