import { describe, expect, test } from "bun:test";
import {
	createEditDiffCacheKey,
	getEditDiffCacheKey,
	getEditDiffContainerClass,
	getEditDiffFileContents,
	hashEditDiffContent,
	isEditDiffClickable,
} from "./agent-tool-edit-diff-state.js";

describe("agent tool edit diff state", () => {
	test("hashes content and creates stable cache keys", () => {
		expect(hashEditDiffContent("same")).toBe(hashEditDiffContent("same"));
		expect(hashEditDiffContent("same")).not.toBe(hashEditDiffContent("different"));
		expect(createEditDiffCacheKey("old", "new", "file.ts")).toBe(
			createEditDiffCacheKey("old", "new", "file.ts")
		);
	});

	test("returns null cache key only when both old and new content are empty", () => {
		expect(
			getEditDiffCacheKey({
				oldString: null,
				newString: null,
				fileName: "app.ts",
			})
		).toBeNull();
		expect(
			getEditDiffCacheKey({
				oldString: "",
				newString: "new",
				fileName: "app.ts",
			})
		).toStartWith("edit-inline-");
	});

	test("builds file contents for Pierre diffs", () => {
		const files = getEditDiffFileContents({
			oldString: null,
			newString: "new content",
			fileName: null,
			cacheKey: "cache",
		});

		expect(files).toEqual({
			oldFile: {
				name: "file.txt",
				contents: "",
				cacheKey: "cache-old",
			},
			newFile: {
				name: "file.txt",
				contents: "new content",
				cacheKey: "cache-new",
			},
		});
		expect(
			getEditDiffFileContents({
				oldString: "old",
				newString: null,
				fileName: "app.ts",
				cacheKey: null,
			})
		).toBeNull();
	});

	test("detects collapsed clickable state", () => {
		expect(isEditDiffClickable({ isExpanded: false, isStreaming: false })).toBe(
			true
		);
		expect(isEditDiffClickable({ isExpanded: true, isStreaming: false })).toBe(
			false
		);
		expect(isEditDiffClickable({ isExpanded: false, isStreaming: true })).toBe(
			false
		);
	});

	test("builds container class from expanded and clickable state", () => {
		expect(
			getEditDiffContainerClass({ isExpanded: true, isClickable: false })
		).toContain("max-h-[200px] overflow-y-auto");
		expect(
			getEditDiffContainerClass({ isExpanded: false, isClickable: true })
		).toContain("h-[72px] overflow-hidden cursor-pointer");
	});
});
