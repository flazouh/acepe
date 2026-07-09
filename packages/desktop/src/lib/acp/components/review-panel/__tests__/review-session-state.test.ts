import { describe, expect, it } from "vitest";

import {
	type FileReviewStatus,
	nextSequentialFileIndex,
	nextUnreviewedFileIndex,
	prevSequentialFileIndex,
} from "../review-session-state.js";

describe("nextUnreviewedFileIndex", () => {
	it("returns the next file that is not reviewed", () => {
		const statuses: Array<FileReviewStatus | undefined> = ["reviewed", "reviewed", "unreviewed"];
		expect(nextUnreviewedFileIndex(0, statuses)).toBe(2);
	});

	it("treats undefined entries as unreviewed", () => {
		const statuses: Array<FileReviewStatus | undefined> = ["reviewed", undefined, "reviewed"];
		expect(nextUnreviewedFileIndex(0, statuses)).toBe(1);
	});

	it("returns null when all later files are reviewed", () => {
		const statuses: Array<FileReviewStatus | undefined> = ["unreviewed", "reviewed", "reviewed"];
		expect(nextUnreviewedFileIndex(1, statuses)).toBeNull();
	});

	it("returns null when current is the last file", () => {
		const statuses: Array<FileReviewStatus | undefined> = ["unreviewed", "unreviewed"];
		expect(nextUnreviewedFileIndex(1, statuses)).toBeNull();
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
