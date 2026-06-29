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

	it("waits for fetched git diff before showing embedded diff when fetched diff is preferred", () => {
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

		expect(
			selectReviewDiffData(null, embedded, {
				preferFetchedDiff: true,
				fetchedDiffSettled: false,
			})
		).toBeNull();
	});

	it("falls back to embedded diff after preferred fetched diff has settled without hunks", () => {
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

		expect(
			selectReviewDiffData(null, embedded, {
				preferFetchedDiff: true,
				fetchedDiffSettled: true,
			})
		).toBe(embedded);
	});

	it("rejects fetched whole-file additions when session stats show deletions", () => {
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 3,
			totalRemoved: 3,
			originalContent: null,
			finalContent: "line-01\nline-02-updated\nline-03\n",
			editCount: 1,
		};
		const fetched = createReviewDiffData(file, null, file.finalContent);
		const embedded = createReviewDiffData(file, "line-01\nline-02\nline-03\n", file.finalContent);

		expect(fetched?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
		expect(embedded?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
		expect(selectReviewDiffData(fetched, embedded, { file })).toBe(embedded);
	});

	it("rejects embedded whole-file additions when original session content exists", () => {
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 1,
			totalRemoved: 0,
			originalContent: "before\n",
			finalContent: "after\n",
			editCount: 1,
		};
		const fetched = createReviewDiffData(file, "before\n", "after\n");
		const embedded = createReviewDiffData(file, null, file.finalContent);

		expect(selectReviewDiffData(null, embedded, { file })).toBeNull();
		expect(selectReviewDiffData(fetched, embedded, { file })).toBe(fetched);
	});
});
