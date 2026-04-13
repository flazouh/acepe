import { type FileContents, parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs", async () => {
	const actual = await vi.importActual<typeof import("@pierre/diffs")>("@pierre/diffs");
	const diffAcceptRejectHunk: typeof actual.diffAcceptRejectHunk = (diff, hunkIndex, action) => {
		const result = actual.diffAcceptRejectHunk(diff, hunkIndex, action);
		const corruptedResult = Object.assign({}, result);
		Reflect.deleteProperty(corruptedResult, "newLines");
		return corruptedResult;
	};

	return Object.assign({}, actual, {
		diffAcceptRejectHunk,
	});
});

function createFile(name: string, contents: string): FileContents {
	return {
		name,
		contents,
	};
}

describe("computeRevertedFileContent regression", () => {
	it("returns full reverted content when resolved metadata omits newLines", async () => {
		const { computeRevertedFileContent } = await import("../compute-reverted-file-content.js");
		const oldContent = "line1\nold\nline3";
		const newContent = "line1\nnew\nline3";
		const oldFile = createFile("test.ts", oldContent);
		const newFile = createFile("test.ts", newContent);
		const metadata = parseDiffFromFile(oldFile, newFile);

		let result = "";
		expect(() => {
			result = computeRevertedFileContent(newContent, metadata, 0);
		}).not.toThrow();

		expect(result).toBe(oldContent);
	});

	it("supports legacy numeric hunk payloads", async () => {
		const { computeRevertedFileContent } = await import("../compute-reverted-file-content.js");

		const legacyMetadata = {
			name: "test.ts",
			prevName: undefined,
			type: "change",
			hunks: [
				{
					collapsedBefore: 0,
					splitLineStart: 1,
					splitLineCount: 1,
					unifiedLineStart: 1,
					unifiedLineCount: 1,
					additionCount: 1,
					additionStart: 2,
					additionLines: 1,
					deletionCount: 1,
					deletionStart: 2,
					deletionLines: 1,
					hunkContent: [
						{
							type: "change",
							deletions: 1,
							additions: 1,
							deletionLineIndex: 1,
							additionLineIndex: 1,
							noEOFCRDeletions: false,
							noEOFCRAdditions: false,
						},
					],
					hunkContext: undefined,
					hunkSpecs: undefined,
				},
			],
			splitLineCount: 0,
			unifiedLineCount: 0,
			deletionLines: ["line1\n", "old\n", "line3"],
			additionLines: ["line1\n", "new\n", "line3"],
		};

		const result = computeRevertedFileContent(
			"line1\nnew\nline3",
			legacyMetadata as unknown as Parameters<typeof computeRevertedFileContent>[1],
			0
		);

		expect(result).toBe("line1\nold\nline3");
	});
});
