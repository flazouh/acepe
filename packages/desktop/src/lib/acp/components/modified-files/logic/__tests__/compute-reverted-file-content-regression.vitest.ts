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
});
