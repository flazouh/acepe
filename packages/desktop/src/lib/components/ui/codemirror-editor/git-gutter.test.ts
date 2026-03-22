import { describe, expect, it } from "vitest";

import { computeLineDiffs } from "./git-gutter.js";

describe("computeLineDiffs", () => {
	it("marks all lines as added for a new file (null oldContent)", () => {
		const result = computeLineDiffs(null, "line1\nline2\nline3");

		expect(result).toEqual([
			{ line: 1, kind: "added" },
			{ line: 2, kind: "added" },
			{ line: 3, kind: "added" },
		]);
	});

	it("returns no markers for identical content", () => {
		const content = "line1\nline2\nline3";
		const result = computeLineDiffs(content, content);

		expect(result).toEqual([]);
	});

	it("marks lines added at end", () => {
		const result = computeLineDiffs("line1\nline2\n", "line1\nline2\nline3\nline4\n");

		expect(result).toEqual([
			{ line: 3, kind: "added" },
			{ line: 4, kind: "added" },
		]);
	});

	it("marks lines added at beginning", () => {
		const result = computeLineDiffs("line1\nline2\n", "new1\nnew2\nline1\nline2\n");

		expect(result).toEqual([
			{ line: 1, kind: "added" },
			{ line: 2, kind: "added" },
		]);
	});

	it("places deleted marker on the next line after deletion", () => {
		const result = computeLineDiffs("line1\nline2\nline3\n", "line1\nline3\n");

		expect(result).toEqual([{ line: 2, kind: "deleted" }]);
	});

	it("places deleted marker on last line when deletion is at EOF", () => {
		const result = computeLineDiffs("line1\nline2\nline3\n", "line1\n");

		expect(result).toEqual([{ line: 1, kind: "deleted" }]);
	});

	it("marks replacement lines as modified (removed+added pair)", () => {
		const result = computeLineDiffs("line1\nold\nline3\n", "line1\nnew\nline3\n");

		expect(result).toEqual([{ line: 2, kind: "modified" }]);
	});

	it("marks multi-line modification", () => {
		const result = computeLineDiffs(
			"line1\nold1\nold2\nline4\n",
			"line1\nnew1\nnew2\nnew3\nline4\n"
		);

		expect(result).toEqual([
			{ line: 2, kind: "modified" },
			{ line: 3, kind: "modified" },
			{ line: 4, kind: "modified" },
		]);
	});

	it("handles mixed changes", () => {
		const oldContent = "keep1\nremove\nkeep2\nold\nkeep3\n";
		const newContent = "keep1\nkeep2\nnew\nkeep3\nadded\n";
		const result = computeLineDiffs(oldContent, newContent);

		// "remove" is deleted (marker at line 2 = "keep2")
		// "old" → "new" is modified (line 3)
		// "added" is added (line 5)
		expect(result).toContainEqual({ line: 2, kind: "deleted" });
		expect(result).toContainEqual({ line: 3, kind: "modified" });
		expect(result).toContainEqual({ line: 5, kind: "added" });
	});

	it("handles empty old content (empty string, not null)", () => {
		const result = computeLineDiffs("", "line1\nline2");

		expect(result.every((d) => d.kind === "added")).toBe(true);
		expect(result.length).toBeGreaterThan(0);
	});

	it("handles empty new content", () => {
		const result = computeLineDiffs("line1\nline2\n", "");

		// All lines deleted — should show a deleted marker
		expect(result.some((d) => d.kind === "deleted")).toBe(true);
	});

	it("handles single-line file change", () => {
		const result = computeLineDiffs("old", "new");

		expect(result).toEqual([{ line: 1, kind: "modified" }]);
	});

	it("handles new file with single empty line (null oldContent, empty string)", () => {
		const result = computeLineDiffs(null, "");

		expect(result).toEqual([{ line: 1, kind: "added" }]);
	});
});
