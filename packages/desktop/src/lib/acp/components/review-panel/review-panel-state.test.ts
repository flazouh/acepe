import { describe, expect, it } from "bun:test";
import { createReviewFileRevisionKey } from "../../review/review-file-revision.js";
import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";
import { buildReviewWorkspaceFileItems } from "./review-panel-state.js";

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

describe("review panel state", () => {
	it("builds sidebar file items with stored reviewed status", () => {
		const reviewedFile = makeFile("src/reviewed.ts");
		const unreviewedFile = makeFile("src/unreviewed.ts");
		const reviewedKeys = new Set<string>([createReviewFileRevisionKey(reviewedFile)]);

		expect(buildReviewWorkspaceFileItems([reviewedFile, unreviewedFile], reviewedKeys)).toEqual([
			{
				id: "src/reviewed.ts",
				filePath: "src/reviewed.ts",
				fileName: "reviewed.ts",
				reviewStatus: "reviewed",
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
});
