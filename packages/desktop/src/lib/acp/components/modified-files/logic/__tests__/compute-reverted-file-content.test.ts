import { describe, expect, it } from "bun:test";
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";

import { computeRevertedFileContent } from "../compute-reverted-file-content.js";

/**
 * Test-only types that match the structure of @pierre/diffs types.
 * These are minimal types for testing purposes only.
 */
interface TestContextContent {
	type: "context";
	lines: string[];
	noEOFCR: boolean;
}

interface TestChangeContent {
	type: "change";
	deletions: string[];
	additions: string[];
	noEOFCRDeletions: boolean;
	noEOFCRAdditions: boolean;
}

type TestHunkContent = TestContextContent | TestChangeContent;

/**
 * Helper to create a minimal FileDiffMetadata for testing.
 */
function createFileDiffMetadata(hunks: Hunk[]): FileDiffMetadata {
	const metadata: FileDiffMetadata = {
		name: "test.ts",
		prevName: undefined,
		type: "change",
		hunks,
		splitLineCount: 0,
		unifiedLineCount: 0,
	};
	return metadata;
}

/**
 * Helper to create a change hunk.
 */
function createChangeHunk(
	deletionStart: number,
	additionStart: number,
	deletions: string[],
	additions: string[]
): Hunk {
	const hunkContent: TestHunkContent[] = [
		{
			type: "change",
			deletions,
			additions,
			noEOFCRDeletions: false,
			noEOFCRAdditions: false,
		},
	];

	const hunk: Hunk = {
		collapsedBefore: 0,
		splitLineStart: 1,
		splitLineCount: 0,
		unifiedLineStart: 1,
		unifiedLineCount: 0,
		deletionStart,
		deletionCount: deletions.length,
		deletionLines: deletions.length,
		additionStart,
		additionCount: additions.length,
		additionLines: additions.length,
		hunkContent,
		hunkContext: undefined,
		hunkSpecs: undefined,
	};
	return hunk;
}

/**
 * Helper to create a hunk with context lines.
 */
function createHunkWithContext(
	deletionStart: number,
	additionStart: number,
	contextBefore: string[],
	deletions: string[],
	additions: string[],
	contextAfter: string[]
): Hunk {
	const hunkContent: TestHunkContent[] = [];

	if (contextBefore.length > 0) {
		hunkContent.push({ type: "context", lines: contextBefore, noEOFCR: false });
	}

	hunkContent.push({
		type: "change",
		deletions,
		additions,
		noEOFCRDeletions: false,
		noEOFCRAdditions: false,
	});

	if (contextAfter.length > 0) {
		hunkContent.push({ type: "context", lines: contextAfter, noEOFCR: false });
	}

	const totalLines = contextBefore.length + deletions.length + contextAfter.length;
	const hunk: Hunk = {
		collapsedBefore: 0,
		splitLineStart: 1,
		splitLineCount: 0,
		unifiedLineStart: 1,
		unifiedLineCount: 0,
		deletionStart,
		deletionCount: totalLines,
		deletionLines: deletions.length,
		additionStart,
		additionCount: contextBefore.length + additions.length + contextAfter.length,
		additionLines: additions.length,
		hunkContent,
		hunkContext: undefined,
		hunkSpecs: undefined,
	};
	return hunk;
}

describe("computeRevertedFileContent", () => {
	describe("single hunk scenarios", () => {
		it("should revert a simple single-line addition", () => {
			// Old file: "line1\nline2"
			// New file: "line1\ninserted\nline2"
			// After revert: "line1\nline2"
			const newFileContent = "line1\ninserted\nline2";
			const hunk = createChangeHunk(2, 2, [], ["inserted"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nline2");
		});

		it("should revert a simple single-line deletion (restore deleted line)", () => {
			// Old file: "line1\ndeleted\nline2"
			// New file: "line1\nline2"
			// After revert: "line1\ndeleted\nline2"
			const newFileContent = "line1\nline2";
			const hunk = createChangeHunk(2, 2, ["deleted"], []);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\ndeleted\nline2");
		});

		it("should revert a single-line replacement", () => {
			// Old file: "line1\nold\nline3"
			// New file: "line1\nnew\nline3"
			// After revert: "line1\nold\nline3"
			const newFileContent = "line1\nnew\nline3";
			const hunk = createChangeHunk(2, 2, ["old"], ["new"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nold\nline3");
		});

		it("should revert a multi-line addition", () => {
			// Old file: "line1\nline4"
			// New file: "line1\nline2\nline3\nline4"
			// After revert: "line1\nline4"
			const newFileContent = "line1\nline2\nline3\nline4";
			const hunk = createChangeHunk(2, 2, [], ["line2", "line3"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nline4");
		});

		it("should revert a multi-line deletion (restore multiple deleted lines)", () => {
			// Old file: "line1\nline2\nline3\nline4"
			// New file: "line1\nline4"
			// After revert: "line1\nline2\nline3\nline4"
			const newFileContent = "line1\nline4";
			const hunk = createChangeHunk(2, 2, ["line2", "line3"], []);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nline2\nline3\nline4");
		});

		it("should revert a multi-line replacement with different counts", () => {
			// Old file: "line1\nold1\nold2\nold3\nline5"
			// New file: "line1\nnew1\nnew2\nline5"
			// After revert: "line1\nold1\nold2\nold3\nline5"
			const newFileContent = "line1\nnew1\nnew2\nline5";
			const hunk = createChangeHunk(2, 2, ["old1", "old2", "old3"], ["new1", "new2"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nold1\nold2\nold3\nline5");
		});
	});

	describe("hunk with context lines", () => {
		it("should correctly handle hunk with context before and after", () => {
			// Old file: "ctx1\nctx2\nold\nctx3\nctx4"
			// New file: "ctx1\nctx2\nnew\nctx3\nctx4"
			// After revert: "ctx1\nctx2\nold\nctx3\nctx4"
			const newFileContent = "ctx1\nctx2\nnew\nctx3\nctx4";
			const hunk = createHunkWithContext(
				1,
				1,
				["ctx1", "ctx2"],
				["old"],
				["new"],
				["ctx3", "ctx4"]
			);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("ctx1\nctx2\nold\nctx3\nctx4");
		});

		it("should correctly handle interleaved context and change blocks", () => {
			// This tests the case where a hunk has multiple change blocks
			// separated by context lines within the same hunk
			// Old file: "ctx1\ndel1\nctx2\ndel2\nctx3"
			// New file: "ctx1\nadd1\nctx2\nadd2\nctx3"
			// After revert: "ctx1\ndel1\nctx2\ndel2\nctx3"
			const newFileContent = "ctx1\nadd1\nctx2\nadd2\nctx3";

			// Build a hunk with: context -> change -> context -> change -> context
			const hunkContent: TestHunkContent[] = [
				{ type: "context", lines: ["ctx1"], noEOFCR: false },
				{
					type: "change",
					deletions: ["del1"],
					additions: ["add1"],
					noEOFCRDeletions: false,
					noEOFCRAdditions: false,
				},
				{ type: "context", lines: ["ctx2"], noEOFCR: false },
				{
					type: "change",
					deletions: ["del2"],
					additions: ["add2"],
					noEOFCRDeletions: false,
					noEOFCRAdditions: false,
				},
				{ type: "context", lines: ["ctx3"], noEOFCR: false },
			];

			const hunk: Hunk = {
				collapsedBefore: 0,
				splitLineStart: 1,
				splitLineCount: 0,
				unifiedLineStart: 1,
				unifiedLineCount: 0,
				deletionStart: 1,
				deletionCount: 5,
				deletionLines: 2,
				additionStart: 1,
				additionCount: 5,
				additionLines: 2,
				hunkContent,
				hunkContext: undefined,
				hunkSpecs: undefined,
			};

			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("ctx1\ndel1\nctx2\ndel2\nctx3");
		});
	});

	describe("multiple hunks scenarios", () => {
		it("should revert only the specified hunk (first of two)", () => {
			// Old file: "line1\noldA\nline3\noldB\nline5"
			// New file: "line1\nnewA\nline3\nnewB\nline5"
			// Revert hunk 0: "line1\noldA\nline3\nnewB\nline5"
			const newFileContent = "line1\nnewA\nline3\nnewB\nline5";
			const hunk0 = createChangeHunk(2, 2, ["oldA"], ["newA"]);
			const hunk1 = createChangeHunk(4, 4, ["oldB"], ["newB"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk0, hunk1]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\noldA\nline3\nnewB\nline5");
		});

		it("should revert only the specified hunk (second of two)", () => {
			// Old file: "line1\noldA\nline3\noldB\nline5"
			// New file: "line1\nnewA\nline3\nnewB\nline5"
			// Revert hunk 1: "line1\nnewA\nline3\noldB\nline5"
			const newFileContent = "line1\nnewA\nline3\nnewB\nline5";
			const hunk0 = createChangeHunk(2, 2, ["oldA"], ["newA"]);
			const hunk1 = createChangeHunk(4, 4, ["oldB"], ["newB"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk0, hunk1]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 1);

			expect(result).toBe("line1\nnewA\nline3\noldB\nline5");
		});
	});

	describe("edge cases", () => {
		it("should return original content if hunk index is out of bounds", () => {
			const newFileContent = "line1\nline2";
			const fileDiffMetadata = createFileDiffMetadata([]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nline2");
		});

		it("should handle empty new file content", () => {
			const newFileContent = "";
			const hunk = createChangeHunk(1, 1, ["old"], []);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("old");
		});

		it("should handle revert at the beginning of file", () => {
			// Old file: "old\nline2\nline3"
			// New file: "new\nline2\nline3"
			// After revert: "old\nline2\nline3"
			const newFileContent = "new\nline2\nline3";
			const hunk = createChangeHunk(1, 1, ["old"], ["new"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("old\nline2\nline3");
		});

		it("should handle revert at the end of file", () => {
			// Old file: "line1\nline2\nold"
			// New file: "line1\nline2\nnew"
			// After revert: "line1\nline2\nold"
			const newFileContent = "line1\nline2\nnew";
			const hunk = createChangeHunk(3, 3, ["old"], ["new"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("line1\nline2\nold");
		});

		it("should handle file with single line", () => {
			const newFileContent = "new";
			const hunk = createChangeHunk(1, 1, ["old"], ["new"]);
			const fileDiffMetadata = createFileDiffMetadata([hunk]);

			const result = computeRevertedFileContent(newFileContent, fileDiffMetadata, 0);

			expect(result).toBe("old");
		});
	});
});
