import { describe, expect, it } from "bun:test";
import { type FileContents, parseDiffFromFile } from "@pierre/diffs";

import { computeRevertedFileContent } from "../compute-reverted-file-content.js";

function createFile(name: string, contents: string): FileContents {
	return { name, contents };
}

function computeRevert(oldContent: string, newContent: string, hunkIndex: number): string {
	const oldFile = createFile("test.ts", oldContent);
	const newFile = createFile("test.ts", newContent);
	const metadata = parseDiffFromFile(oldFile, newFile);

	return computeRevertedFileContent(newContent, metadata, hunkIndex);
}

describe("computeRevertedFileContent", () => {
	it("reverts a single-line replacement", () => {
		const result = computeRevert("line1\nold\nline3", "line1\nnew\nline3", 0);

		expect(result).toBe("line1\nold\nline3");
	});

	it("reverts a multi-line deletion", () => {
		const result = computeRevert("line1\nline2\nline3\nline4", "line1\nline4", 0);

		expect(result).toBe("line1\nline2\nline3\nline4");
	});

	it("reverts a multi-line addition", () => {
		const result = computeRevert("line1\nline4", "line1\nline2\nline3\nline4", 0);

		expect(result).toBe("line1\nline4");
	});

	it("reverts only the targeted hunk when multiple hunks exist", () => {
		const oldContent = [
			"line1",
			"oldA",
			"line3",
			"line4",
			"line5",
			"line6",
			"line7",
			"line8",
			"line9",
			"line10",
			"line11",
			"line12",
			"line13",
			"line14",
			"line15",
			"line16",
			"line17",
			"line18",
			"line19",
			"line20",
			"line21",
			"line22",
			"line23",
			"line24",
			"line25",
			"line26",
			"line27",
			"line28",
			"line29",
			"oldB",
			"line31",
		].join("\n");
		const newContent = [
			"line1",
			"newA",
			"line3",
			"line4",
			"line5",
			"line6",
			"line7",
			"line8",
			"line9",
			"line10",
			"line11",
			"line12",
			"line13",
			"line14",
			"line15",
			"line16",
			"line17",
			"line18",
			"line19",
			"line20",
			"line21",
			"line22",
			"line23",
			"line24",
			"line25",
			"line26",
			"line27",
			"line28",
			"line29",
			"newB",
			"line31",
		].join("\n");

		const result = computeRevert(oldContent, newContent, 1);

		expect(result).toBe(
			[
				"line1",
				"newA",
				"line3",
				"line4",
				"line5",
				"line6",
				"line7",
				"line8",
				"line9",
				"line10",
				"line11",
				"line12",
				"line13",
				"line14",
				"line15",
				"line16",
				"line17",
				"line18",
				"line19",
				"line20",
				"line21",
				"line22",
				"line23",
				"line24",
				"line25",
				"line26",
				"line27",
				"line28",
				"line29",
				"oldB",
				"line31",
			].join("\n")
		);
	});

	it("returns original content when hunk index is out of bounds", () => {
		const newContent = "line1\nline2";
		const oldFile = createFile("test.ts", "line1\nline2\nline3");
		const newFile = createFile("test.ts", newContent);
		const metadata = parseDiffFromFile(oldFile, newFile);

		const result = computeRevertedFileContent(newContent, metadata, 99);

		expect(result).toBe(newContent);
	});
});
