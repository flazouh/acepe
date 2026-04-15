import { describe, expect, it } from "vitest";

import {
	computeFileReviewStatus,
	isPendingFile,
	nextPendingFileIndex,
	nextSequentialFileIndex,
	nextUnacceptedFileIndex,
	type PerFileReviewState,
	prevPendingFileIndex,
	prevSequentialFileIndex,
	shouldAutoAdvanceAfterFileResolution,
	shouldShowReviewNextFileCta,
} from "../review-session-state.js";

function makeState(
	overrides: Partial<PerFileReviewState> & { filePath: string }
): PerFileReviewState {
	return {
		filePath: overrides.filePath,
		acceptedHunks: overrides.acceptedHunks ?? 0,
		rejectedHunks: overrides.rejectedHunks ?? 0,
		pendingHunks: overrides.pendingHunks ?? 0,
		totalHunks: overrides.totalHunks ?? 0,
		status: overrides.status ?? "partial",
	};
}

describe("computeFileReviewStatus", () => {
	it("returns denied when isDenied is true", () => {
		expect(
			computeFileReviewStatus(
				{ acceptedHunks: 5, rejectedHunks: 0, pendingHunks: 0, totalHunks: 5 },
				true
			)
		).toBe("denied");
	});

	it("returns accepted when all hunks accepted and not denied", () => {
		expect(
			computeFileReviewStatus(
				{ acceptedHunks: 5, rejectedHunks: 0, pendingHunks: 0, totalHunks: 5 },
				false
			)
		).toBe("accepted");
	});

	it("returns partial when there are pending hunks", () => {
		expect(
			computeFileReviewStatus(
				{ acceptedHunks: 2, rejectedHunks: 0, pendingHunks: 3, totalHunks: 5 },
				false
			)
		).toBe("partial");
	});

	it("returns partial when there are rejected hunks", () => {
		expect(
			computeFileReviewStatus(
				{ acceptedHunks: 2, rejectedHunks: 2, pendingHunks: 0, totalHunks: 4 },
				false
			)
		).toBe("partial");
	});
});

describe("isPendingFile", () => {
	it("returns true when pendingHunks > 0 and not denied", () => {
		expect(isPendingFile(makeState({ filePath: "a", pendingHunks: 1, status: "partial" }))).toBe(
			true
		);
	});

	it("returns false when denied", () => {
		expect(isPendingFile(makeState({ filePath: "a", pendingHunks: 1, status: "denied" }))).toBe(
			false
		);
	});

	it("returns false when no pending hunks", () => {
		expect(isPendingFile(makeState({ filePath: "a", pendingHunks: 0, status: "accepted" }))).toBe(
			false
		);
	});
});

describe("nextPendingFileIndex", () => {
	it("returns next index when next file is pending", () => {
		const states: Array<PerFileReviewState | undefined> = [
			makeState({ filePath: "a", pendingHunks: 0, status: "accepted" }),
			makeState({ filePath: "b", pendingHunks: 2, status: "partial" }),
		];
		expect(nextPendingFileIndex(0, states)).toBe(1);
	});

	it("returns null when no next pending file", () => {
		const states: Array<PerFileReviewState | undefined> = [
			makeState({ filePath: "a", pendingHunks: 0, status: "accepted" }),
			makeState({ filePath: "b", pendingHunks: 0, status: "accepted" }),
		];
		expect(nextPendingFileIndex(0, states)).toBe(null);
	});

	it("skips non-pending files", () => {
		const states: Array<PerFileReviewState | undefined> = [
			makeState({ filePath: "a", pendingHunks: 0, status: "accepted" }),
			makeState({ filePath: "b", pendingHunks: 0, status: "accepted" }),
			makeState({ filePath: "c", pendingHunks: 1, status: "partial" }),
		];
		expect(nextPendingFileIndex(0, states)).toBe(2);
	});
});

describe("prevPendingFileIndex", () => {
	it("returns prev index when prev file is pending", () => {
		const states: Array<PerFileReviewState | undefined> = [
			makeState({ filePath: "a", pendingHunks: 2, status: "partial" }),
			makeState({ filePath: "b", pendingHunks: 0, status: "accepted" }),
		];
		expect(prevPendingFileIndex(1, states)).toBe(0);
	});

	it("returns null when no prev pending file", () => {
		const states: Array<PerFileReviewState | undefined> = [
			makeState({ filePath: "a", pendingHunks: 0, status: "accepted" }),
			makeState({ filePath: "b", pendingHunks: 0, status: "accepted" }),
		];
		expect(prevPendingFileIndex(1, states)).toBe(null);
	});
});

describe("shouldShowReviewNextFileCta", () => {
	it("returns true when current accepted and next pending exists", () => {
		expect(shouldShowReviewNextFileCta(true, true)).toBe(true);
	});

	it("returns false when current not accepted", () => {
		expect(shouldShowReviewNextFileCta(false, true)).toBe(false);
	});

	it("returns false when no next pending file", () => {
		expect(shouldShowReviewNextFileCta(true, false)).toBe(false);
	});
});

describe("shouldAutoAdvanceAfterFileResolution", () => {
	it("returns true when file has no pending hunks and had hunks", () => {
		expect(
			shouldAutoAdvanceAfterFileResolution({
				acceptedHunks: 1,
				rejectedHunks: 0,
				pendingHunks: 0,
				totalHunks: 1,
			})
		).toBe(true);
	});

	it("returns false when file still has pending hunks", () => {
		expect(
			shouldAutoAdvanceAfterFileResolution({
				acceptedHunks: 0,
				rejectedHunks: 0,
				pendingHunks: 1,
				totalHunks: 1,
			})
		).toBe(false);
	});

	it("returns false when file has zero hunks", () => {
		expect(
			shouldAutoAdvanceAfterFileResolution({
				acceptedHunks: 0,
				rejectedHunks: 0,
				pendingHunks: 0,
				totalHunks: 0,
			})
		).toBe(false);
	});
});

describe("nextUnacceptedFileIndex", () => {
	it("returns the next file that is not accepted", () => {
		expect(nextUnacceptedFileIndex(0, ["accepted", "accepted", "partial"])).toBe(2);
	});

	it("treats undefined entries as unreviewed", () => {
		expect(nextUnacceptedFileIndex(0, ["accepted", undefined, "accepted"])).toBe(1);
	});

	it("returns null when all later files are accepted", () => {
		expect(nextUnacceptedFileIndex(1, ["partial", "accepted", "accepted"])).toBeNull();
	});
});

describe("nextSequentialFileIndex", () => {
	it("returns next index when current file is not last", () => {
		expect(nextSequentialFileIndex(0, 3)).toBe(1);
	});

	it("returns null when current file is the last file", () => {
		expect(nextSequentialFileIndex(2, 3)).toBeNull();
	});

	it("returns null for invalid total file count", () => {
		expect(nextSequentialFileIndex(0, 0)).toBeNull();
	});
});

describe("prevSequentialFileIndex", () => {
	it("returns previous index when current file is not first", () => {
		expect(prevSequentialFileIndex(2)).toBe(1);
	});

	it("returns null when current file is the first file", () => {
		expect(prevSequentialFileIndex(0)).toBeNull();
	});
});
