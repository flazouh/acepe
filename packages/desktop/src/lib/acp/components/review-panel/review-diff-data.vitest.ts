import { describe, expect, it } from "vitest";

import { createReviewDiffData } from "./review-diff-data.js";

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
});
