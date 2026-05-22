import { describe, expect, it } from "vitest";

import type { FilePickerEntry } from "../../types/file-picker-entry.js";

import {
	getFilePreviewCacheKeys,
	getFilePreviewName,
	getPreviewFile,
	shouldDeferFilePreview,
	shouldRenderFilePreviewDiff,
} from "./file-picker-preview-state.js";

function createFile(path: string): FilePickerEntry {
	const extension = path.split(".").pop();
	return {
		path,
		extension: extension ? extension : "",
		lineCount: 1,
		gitStatus: null,
	};
}

describe("file picker preview state", () => {
	it("defers preview while a non-empty query is actively changing", () => {
		expect(shouldDeferFilePreview("")).toBe(false);
		expect(shouldDeferFilePreview("abc")).toBe(true);
	});

	it("hides preview while filtering with a query", () => {
		const files = [createFile("src/app.ts")];

		expect(getPreviewFile(files, 0, true)).toBeNull();
	});

	it("shows preview when there is no active query", () => {
		const files = [createFile("src/app.ts"), createFile("src/lib.ts")];

		expect(getPreviewFile(files, 1, false)).toEqual(files[1]);
	});

	it("extracts file preview names from paths", () => {
		expect(getFilePreviewName("src/components/card.svelte")).toBe("card.svelte");
		expect(getFilePreviewName("README.md")).toBe("README.md");
	});

	it("builds stable cache keys for file and diff renders", () => {
		expect(
			getFilePreviewCacheKeys({
				projectPath: "/repo",
				filePath: "src/app.ts",
			})
		).toEqual({
			file: "file-/repo-src/app.ts",
			diffOld: "diff-old-/repo-src/app.ts",
			diffOldEmpty: "diff-old-empty-/repo-src/app.ts",
			diffNew: "diff-new-/repo-src/app.ts",
		});
	});

	it("renders a diff preview only when the file has git status", () => {
		expect(shouldRenderFilePreviewDiff(createFile("src/app.ts"))).toBe(false);
		expect(
			shouldRenderFilePreviewDiff({
				...createFile("src/app.ts"),
				gitStatus: {
					path: "src/app.ts",
					status: "modified",
					insertions: 1,
					deletions: 0,
				},
			})
		).toBe(true);
	});
});
