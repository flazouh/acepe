import { describe, expect, it } from "vitest";

import { createReviewDiffData, selectReviewDiffData } from "./review-diff-data.js";

describe("createReviewDiffData", () => {
	it("builds whole-file diff data from provided old and new file contents", () => {
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 1,
			totalRemoved: 1,
			originalContent: "const before = 1;\n",
			finalContent: "const after = 2;\n",
			editCount: 1,
		};

		const result = createReviewDiffData(
			file,
			["line-01", "line-02", "line-03"].join("\n"),
			["line-01", "line-02-updated", "line-03", "line-04"].join("\n")
		);

		expect(result?.oldFile.contents).toBe(["line-01", "line-02", "line-03"].join("\n"));
		expect(result?.newFile.contents).toBe(
			["line-01", "line-02-updated", "line-03", "line-04"].join("\n")
		);
		expect(result?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
	});

	it("returns null when neither side has file content", () => {
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 0,
			totalRemoved: 0,
			originalContent: null,
			finalContent: null,
			editCount: 0,
		};

		expect(createReviewDiffData(file, null, null)).toBeNull();
	});

	it("keeps session diff data when fetched git diff has no hunks", () => {
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 1,
			totalRemoved: 1,
			originalContent: "const before = 1;\n",
			finalContent: "const after = 2;\n",
			editCount: 1,
		};
		const embedded = createReviewDiffData(file, "const before = 1;\n", "const after = 2;\n");
		const fetched = createReviewDiffData(file, "const after = 2;\n", "const after = 2;\n");

		expect(embedded?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
		expect(fetched?.fileDiffMetadata.hunks.length).toBe(0);
		expect(selectReviewDiffData(fetched, embedded)).toBe(embedded);
	});

	it("prefers fetched git diff when it has hunks", () => {
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 1,
			totalRemoved: 1,
			originalContent: "const before = 1;\n",
			finalContent: "const after = 2;\n",
			editCount: 1,
		};
		const embedded = createReviewDiffData(file, "before\n", "after\n");
		const fetched = createReviewDiffData(file, "before\n", "after from disk\n");

		expect(fetched?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
		expect(selectReviewDiffData(fetched, embedded)).toBe(fetched);
	});
});
