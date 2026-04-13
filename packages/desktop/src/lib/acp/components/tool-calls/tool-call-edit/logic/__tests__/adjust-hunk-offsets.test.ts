import { describe, expect, it } from "bun:test";
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";

import { adjustHunkOffsets } from "../adjust-hunk-offsets.js";

function createMinimalHunk(overrides: Partial<Hunk> = {}): Hunk {
	const baseHunk: Hunk = {
		collapsedBefore: 0,
		splitLineStart: 1,
		splitLineCount: 1,
		unifiedLineStart: 1,
		unifiedLineCount: 1,
		additionCount: 1,
		additionStart: 1,
		additionLines: 1,
		deletionCount: 1,
		deletionStart: 1,
		deletionLines: 1,
		hunkContent: [],
		hunkContext: undefined,
		hunkSpecs: undefined,
	};

	return Object.assign(baseHunk, overrides);
}

function createMinimalFileDiff(overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata {
	const baseFileDiff: FileDiffMetadata = {
		name: "test.ts",
		prevName: undefined,
		type: "change",
		hunks: [],
		splitLineCount: 0,
		unifiedLineCount: 0,
		oldLines: [],
		newLines: [],
	};

	return Object.assign(baseFileDiff, overrides);
}

describe("adjustHunkOffsets", () => {
	it("should not modify hunks when startLine is 1 (no offset)", () => {
		const fileDiff = createMinimalFileDiff({
			hunks: [
				createMinimalHunk({
					additionStart: 1,
					deletionStart: 1,
				}),
			],
		});

		const result = adjustHunkOffsets(fileDiff, 1);

		expect(result.hunks[0].additionStart).toBe(1);
		expect(result.hunks[0].deletionStart).toBe(1);
	});

	it("should offset hunks when startLine is greater than 1", () => {
		const fileDiff = createMinimalFileDiff({
			hunks: [
				createMinimalHunk({
					additionStart: 1,
					deletionStart: 1,
				}),
			],
		});

		const result = adjustHunkOffsets(fileDiff, 10);

		expect(result.hunks[0].additionStart).toBe(10);
		expect(result.hunks[0].deletionStart).toBe(10);
	});

	it("should offset multiple hunks correctly", () => {
		const fileDiff = createMinimalFileDiff({
			hunks: [
				createMinimalHunk({
					additionStart: 1,
					deletionStart: 1,
				}),
				createMinimalHunk({
					additionStart: 5,
					deletionStart: 5,
				}),
			],
		});

		const result = adjustHunkOffsets(fileDiff, 100);

		expect(result.hunks[0].additionStart).toBe(100);
		expect(result.hunks[0].deletionStart).toBe(100);
		expect(result.hunks[1].additionStart).toBe(104);
		expect(result.hunks[1].deletionStart).toBe(104);
	});

	it("should preserve other hunk properties", () => {
		const fileDiff = createMinimalFileDiff({
			hunks: [
				createMinimalHunk({
					additionStart: 1,
					deletionStart: 1,
					additionCount: 5,
					deletionCount: 3,
					hunkContext: "some context",
				}),
			],
		});

		const result = adjustHunkOffsets(fileDiff, 50);

		expect(result.hunks[0].additionCount).toBe(5);
		expect(result.hunks[0].deletionCount).toBe(3);
		expect(result.hunks[0].hunkContext).toBe("some context");
	});

	it("should preserve other fileDiff properties", () => {
		const fileDiff = createMinimalFileDiff({
			name: "my-file.ts",
			type: "change",
			splitLineCount: 10,
			unifiedLineCount: 20,
			hunks: [createMinimalHunk()],
		});

		const result = adjustHunkOffsets(fileDiff, 5);

		expect(result.name).toBe("my-file.ts");
		expect(result.type).toBe("change");
		expect(result.splitLineCount).toBe(10);
		expect(result.unifiedLineCount).toBe(20);
	});

	it("should handle empty hunks array", () => {
		const fileDiff = createMinimalFileDiff({
			hunks: [],
		});

		const result = adjustHunkOffsets(fileDiff, 10);

		expect(result.hunks).toEqual([]);
	});

	it("should not mutate the original fileDiff", () => {
		const originalHunk = createMinimalHunk({
			additionStart: 1,
			deletionStart: 1,
		});
		const fileDiff = createMinimalFileDiff({
			hunks: [originalHunk],
		});

		adjustHunkOffsets(fileDiff, 50);

		expect(fileDiff.hunks[0].additionStart).toBe(1);
		expect(fileDiff.hunks[0].deletionStart).toBe(1);
	});
});
