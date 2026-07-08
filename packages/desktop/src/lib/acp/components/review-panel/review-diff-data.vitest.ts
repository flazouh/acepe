import { describe, expect, it } from "vitest";

import {
	createReviewDiffData,
	createReviewDiffDataFromBaseAndEdits,
	selectReviewDiffData,
} from "./review-diff-data.js";

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

	it("builds whole-file diff data from base content and ordered edit snippets", () => {
		const baseContent = [
			'import { Result } from "neverthrow";',
			"const alpha = 1;",
			"const beta = 2;",
		].join("\n");
		const nextContent = [
			'import { Result, ResultAsync } from "neverthrow";',
			"const alpha = 10;",
			"const beta = 2;",
		].join("\n");
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 2,
			totalRemoved: 2,
			originalContent: 'import { Result } from "neverthrow";',
			finalContent: "const alpha = 10;",
			edits: [
				{
					oldString: 'import { Result } from "neverthrow";',
					newString: 'import { Result, ResultAsync } from "neverthrow";',
					content: null,
				},
				{
					oldString: "const alpha = 1;",
					newString: "const alpha = 10;",
					content: null,
				},
			],
			editCount: 2,
		};

		const result = createReviewDiffDataFromBaseAndEdits(file, baseContent);

		expect(result?.oldFile.contents).toBe(baseContent);
		expect(result?.newFile.contents).toBe(nextContent);
		expect(result?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
	});

	it("builds whole-file diff data when base content is already the final file", () => {
		const previousContent = [
			'import { Result } from "neverthrow";',
			"const alpha = 1;",
			"const beta = 2;",
		].join("\n");
		const baseContent = [
			'import { Result, ResultAsync } from "neverthrow";',
			"const alpha = 10;",
			"const beta = 2;",
		].join("\n");
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 2,
			totalRemoved: 2,
			originalContent: 'import { Result } from "neverthrow";',
			finalContent: "const alpha = 10;",
			edits: [
				{
					oldString: 'import { Result } from "neverthrow";',
					newString: 'import { Result, ResultAsync } from "neverthrow";',
					content: null,
				},
				{
					oldString: "const alpha = 1;",
					newString: "const alpha = 10;",
					content: null,
				},
			],
			editCount: 2,
		};

		const result = createReviewDiffDataFromBaseAndEdits(file, baseContent);

		expect(result?.oldFile.contents).toBe(previousContent);
		expect(result?.newFile.contents).toBe(baseContent);
		expect(result?.fileDiffMetadata.hunks.length).toBeGreaterThan(0);
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

	it("prefers reconstructed full-file diff over partial embedded snippets", () => {
		const baseContent = ["const first = 1;", "const second = 2;", "const third = 3;"].join("\n");
		const file = {
			filePath: "/project/src/example.ts",
			fileName: "example.ts",
			totalAdded: 2,
			totalRemoved: 2,
			originalContent: "const first = 1;",
			finalContent: "const second = 20;",
			edits: [
				{ oldString: "const first = 1;", newString: "const first = 10;", content: null },
				{ oldString: "const second = 2;", newString: "const second = 20;", content: null },
			],
			editCount: 2,
		};
		const embedded = createReviewDiffData(file, file.originalContent, file.finalContent);
		const fetched = createReviewDiffData(file, baseContent, baseContent);
		const reconstructed = createReviewDiffDataFromBaseAndEdits(file, baseContent);

		expect(fetched?.fileDiffMetadata.hunks.length).toBe(0);
		expect(embedded?.newFile.contents.split("\n").length).toBe(1);
		expect(reconstructed?.newFile.contents.split("\n").length).toBe(3);
		expect(
			selectReviewDiffData(fetched, embedded, {
				preferFetchedDiff: true,
				fetchedDiffSettled: true,
				file,
				reconstructedDiffData: reconstructed,
			})
		).toBe(reconstructed);
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
