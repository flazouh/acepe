import { describe, expect, it } from "vitest";

import {
	areReviewFileSnapshotsEqual,
	createReviewFileRevisionKey,
} from "../review-file-revision.js";

const BASE_FILE = {
	filePath: "/repo/src/example.ts",
	editCount: 1,
	totalAdded: 2,
	totalRemoved: 1,
	originalContent: "const a = 1;\n",
	finalContent: "const a = 2;\n",
};

describe("createReviewFileRevisionKey", () => {
	it("returns identical key for identical file revision snapshots", () => {
		const keyA = createReviewFileRevisionKey(BASE_FILE);
		const keyB = createReviewFileRevisionKey({ ...BASE_FILE });
		expect(keyA).toBe(keyB);
	});

	it("returns different key when final content changes for same file path", () => {
		const keyA = createReviewFileRevisionKey(BASE_FILE);
		const keyB = createReviewFileRevisionKey({
			...BASE_FILE,
			finalContent: "const a = 3;\n",
		});
		expect(keyA).not.toBe(keyB);
	});
});

describe("areReviewFileSnapshotsEqual", () => {
	it("returns true for identical snapshots", () => {
		expect(areReviewFileSnapshotsEqual(BASE_FILE, { ...BASE_FILE })).toBe(true);
	});

	it("returns false when only the file path matches but content changed", () => {
		expect(
			areReviewFileSnapshotsEqual(BASE_FILE, {
				...BASE_FILE,
				finalContent: "const a = 42;\n",
			})
		).toBe(false);
	});
});
