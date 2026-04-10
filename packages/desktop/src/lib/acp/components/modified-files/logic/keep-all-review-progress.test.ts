import { describe, expect, it } from "bun:test";

import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import { buildKeepAllReviewEntries } from "./keep-all-review-progress.js";

const modifiedFiles = [
	{
		filePath: "/repo/src/alpha.ts",
		fileName: "alpha.ts",
		totalAdded: 2,
		totalRemoved: 1,
		originalContent: "const alpha = 1;\n",
		finalContent: "const alpha = 2;\nconst beta = 3;\n",
		editCount: 1,
	},
	{
		filePath: "/repo/src/beta.ts",
		fileName: "beta.ts",
		totalAdded: 3,
		totalRemoved: 0,
		originalContent: "export function beta() {\n\treturn 1;\n}\n",
		finalContent: "export function beta() {\n\tconst nextValue = 2;\n\treturn nextValue;\n}\n",
		editCount: 1,
	},
] as const;

describe("buildKeepAllReviewEntries", () => {
	it("creates accepted review progress for every modified file revision", () => {
		const entries = buildKeepAllReviewEntries(modifiedFiles);

		expect(entries).toHaveLength(modifiedFiles.length);

		for (const [index, entry] of entries.entries()) {
			const file = modifiedFiles[index];

			expect(entry.revisionKey).toBe(createReviewFileRevisionKey(file));
			expect(entry.progress.filePath).toBe(file.filePath);
			expect(entry.progress.status).toBe("accepted");
			expect(entry.progress.pendingHunks).toBe(0);
			expect(entry.progress.rejectedHunks).toBe(0);
			expect(entry.progress.acceptedHunks).toBe(entry.progress.totalHunks);
			expect(entry.progress.totalHunks).toBeGreaterThan(0);
			expect(entry.progress.resolvedActions).toHaveLength(entry.progress.totalHunks);
			expect(entry.progress.resolvedActions.every((action) => action.action === "accept")).toBe(
				true
			);
		}
	});
});
