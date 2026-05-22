import { describe, expect, it } from "bun:test";
import { createReviewFileRevisionKey } from "../../review/review-file-revision.js";
import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";
import {
	buildReviewWorkspaceFileItems,
	getReviewBottomHunkStats,
	type ReviewHunkStatsSource,
} from "./review-panel-state.js";
import type { PerFileReviewState } from "./review-session-state.js";

function makeFile(filePath: string): ModifiedFileEntry {
	return {
		filePath,
		fileName: filePath.split("/").at(-1) ?? filePath,
		totalAdded: 3,
		totalRemoved: 1,
		originalContent: null,
		finalContent: null,
		editCount: 1,
	};
}

function makeReviewState(file: ModifiedFileEntry, status: PerFileReviewState["status"]) {
	return {
		filePath: file.filePath,
		acceptedHunks: status === "accepted" ? 1 : 0,
		rejectedHunks: status === "denied" ? 1 : 0,
		pendingHunks: status === "partial" ? 1 : 0,
		totalHunks: 1,
		status,
	};
}

function makeHunkStatsSource(input: {
	total: number;
	pending: number;
	pendingIndices: number[];
	active: number | null;
}): ReviewHunkStatsSource {
	return {
		getHunkStats: () => ({
			total: input.total,
			pending: input.pending,
			accepted: 0,
			rejected: 0,
		}),
		getPendingHunkIndices: () => input.pendingIndices,
		getActiveHunkIndex: () => input.active,
	};
}

describe("review panel state", () => {
	it("builds sidebar file items with stored review status", () => {
		const acceptedFile = makeFile("src/accepted.ts");
		const unreviewedFile = makeFile("src/unreviewed.ts");
		const statuses = new Map<string, PerFileReviewState>([
			[createReviewFileRevisionKey(acceptedFile), makeReviewState(acceptedFile, "accepted")],
		]);

		expect(buildReviewWorkspaceFileItems([acceptedFile, unreviewedFile], statuses)).toEqual([
			{
				id: "src/accepted.ts",
				filePath: "src/accepted.ts",
				fileName: "accepted.ts",
				reviewStatus: "accepted",
				additions: 3,
				deletions: 1,
			},
			{
				id: "src/unreviewed.ts",
				filePath: "src/unreviewed.ts",
				fileName: "unreviewed.ts",
				reviewStatus: "unreviewed",
				additions: 3,
				deletions: 1,
			},
		]);
	});

	it("returns empty bottom hunk stats when no diff state is ready", () => {
		expect(getReviewBottomHunkStats(null)).toEqual({
			hasPrev: false,
			hasNext: false,
			hasPending: false,
			hunkCurrent: 0,
			hunkTotal: 0,
		});
	});

	it("builds bottom hunk stats for the active pending hunk", () => {
		const source = makeHunkStatsSource({
			total: 5,
			pending: 3,
			pendingIndices: [2, 4, 7],
			active: 4,
		});

		expect(getReviewBottomHunkStats(source)).toEqual({
			hasPrev: true,
			hasNext: true,
			hasPending: true,
			hunkCurrent: 2,
			hunkTotal: 3,
		});
	});

	it("uses the total hunk count when no pending hunk remains", () => {
		const source = makeHunkStatsSource({
			total: 5,
			pending: 0,
			pendingIndices: [],
			active: null,
		});

		expect(getReviewBottomHunkStats(source)).toEqual({
			hasPrev: false,
			hasNext: false,
			hasPending: false,
			hunkCurrent: 0,
			hunkTotal: 5,
		});
	});
});
