import type { ReviewWorkspaceFileItem } from "@acepe/ui";
import { createReviewFileRevisionKey } from "../../review/review-file-revision.js";
import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";
import type { PerFileReviewState } from "./review-session-state.js";

export interface ReviewHunkStatsSource {
	getHunkStats(): { total: number; pending: number; accepted: number; rejected: number };
	getPendingHunkIndices(): number[];
	getActiveHunkIndex(): number | null;
}

export interface ReviewBottomHunkStats {
	readonly hasPrev: boolean;
	readonly hasNext: boolean;
	readonly hasPending: boolean;
	readonly hunkCurrent: number;
	readonly hunkTotal: number;
}

export function buildReviewWorkspaceFileItems(
	files: readonly ModifiedFileEntry[],
	fileStatuses: ReadonlyMap<string, PerFileReviewState>
): ReviewWorkspaceFileItem[] {
	return files.map((file) => {
		const fileKey = createReviewFileRevisionKey(file);
		const status = fileStatuses.get(fileKey)?.status;

		return {
			id: file.filePath,
			filePath: file.filePath,
			fileName: file.fileName,
			reviewStatus: status ?? "unreviewed",
			additions: file.totalAdded,
			deletions: file.totalRemoved,
		};
	});
}

export function getReviewBottomHunkStats(
	state: ReviewHunkStatsSource | null
): ReviewBottomHunkStats {
	if (!state) {
		return {
			hasPrev: false,
			hasNext: false,
			hasPending: false,
			hunkCurrent: 0,
			hunkTotal: 0,
		};
	}

	const stats = state.getHunkStats();
	const pending = state.getPendingHunkIndices();
	const active = state.getActiveHunkIndex();
	const activeIdx = active !== null ? pending.indexOf(active) : 0;
	const hunkCurrent = pending.length > 0 ? activeIdx + 1 : 0;
	const hunkTotal = pending.length || stats.total;

	return {
		hasPrev: pending.length > 1 && activeIdx > 0,
		hasNext: pending.length > 1 && activeIdx < pending.length - 1 && activeIdx >= 0,
		hasPending: stats.pending > 0,
		hunkCurrent,
		hunkTotal,
	};
}
