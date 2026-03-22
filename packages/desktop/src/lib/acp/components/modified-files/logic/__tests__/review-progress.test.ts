import { describe, expect, it } from "vitest";
import { createReviewFileRevisionKey } from "../../../../review/review-file-revision.js";
import type { SessionReviewState } from "../../../../store/session-review-state-store.svelte.js";
import { getReviewStatusByFilePath } from "../review-progress.js";

const BASE_FILE = {
	filePath: "/repo/src/example.ts",
	fileName: "example.ts",
	totalAdded: 2,
	totalRemoved: 1,
	originalContent: "const a = 1;\n",
	finalContent: "const a = 2;\n",
	editCount: 1,
};

describe("getReviewStatusByFilePath", () => {
	it("returns persisted status when revision key matches", () => {
		const revisionKey = createReviewFileRevisionKey(BASE_FILE);
		const state: SessionReviewState = {
			version: 1,
			filesByRevisionKey: {
				[revisionKey]: {
					filePath: BASE_FILE.filePath,
					status: "accepted",
					acceptedHunks: 2,
					rejectedHunks: 0,
					pendingHunks: 0,
					totalHunks: 2,
					resolvedActions: [
						{ hunkIndex: 0, action: "accept" },
						{ hunkIndex: 1, action: "accept" },
					],
				},
			},
		};

		const statusByPath = getReviewStatusByFilePath([BASE_FILE], state);

		expect(statusByPath.get(BASE_FILE.filePath)).toBe("accepted");
	});

	it("does not reuse status when file content changed later", () => {
		const oldRevisionKey = createReviewFileRevisionKey(BASE_FILE);
		const state: SessionReviewState = {
			version: 1,
			filesByRevisionKey: {
				[oldRevisionKey]: {
					filePath: BASE_FILE.filePath,
					status: "accepted",
					acceptedHunks: 2,
					rejectedHunks: 0,
					pendingHunks: 0,
					totalHunks: 2,
					resolvedActions: [],
				},
			},
		};
		const changedFile = {
			...BASE_FILE,
			finalContent: "const a = 3;\n",
		};

		const statusByPath = getReviewStatusByFilePath([changedFile], state);

		expect(statusByPath.get(changedFile.filePath)).toBeUndefined();
	});
});
