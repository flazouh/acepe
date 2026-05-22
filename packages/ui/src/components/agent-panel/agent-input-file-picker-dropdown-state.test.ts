import { describe, expect, test } from "bun:test";
import {
	calculateFilePickerScore,
	FILE_PICKER_DROPDOWN_HEIGHT,
	FILE_PICKER_DROPDOWN_PADDING,
	FILE_PICKER_DROPDOWN_WIDTH,
	FILE_PICKER_RESULT_LIMIT,
	getEffectiveFilePickerIndex,
	getFilePickerFileName,
	getFilePickerPosition,
	getFilePickerPreviewFile,
	getFilteredFilePickerFiles,
	getNextFilePickerIndex,
	shouldDeferFilePickerPreview,
	type AgentInputFilePickerEntry,
} from "./agent-input-file-picker-dropdown-state.js";

function makeFile(path: string): AgentInputFilePickerEntry {
	return {
		path,
		extension: path.split(".").pop() ?? "",
		lineCount: 10,
		gitStatus: null,
	};
}

describe("agent input file picker dropdown state", () => {
	test("extracts file names from paths", () => {
		expect(getFilePickerFileName("/repo/src/app.ts")).toBe("app.ts");
		expect(getFilePickerFileName("README.md")).toBe("README.md");
	});

	test("scores direct filename matches above path matches and fuzzy matches", () => {
		const nameMatch = calculateFilePickerScore("app", makeFile("/repo/src/app.ts"));
		const pathMatch = calculateFilePickerScore("repo", makeFile("/repo/src/app.ts"));
		const fuzzyMatch = calculateFilePickerScore("at", makeFile("/repo/src/app.ts"));

		expect(nameMatch).toBeGreaterThan(pathMatch ?? 0);
		expect(pathMatch).toBeGreaterThan(fuzzyMatch ?? 0);
		expect(calculateFilePickerScore("zzz", makeFile("/repo/src/app.ts"))).toBeNull();
	});

	test("filters and sorts files by score with result limit", () => {
		const files = [
			makeFile("/repo/src/components/button.ts"),
			makeFile("/repo/src/app.ts"),
			makeFile("/repo/src/application.ts"),
			...Array.from({ length: FILE_PICKER_RESULT_LIMIT + 2 }, (_, index) =>
				makeFile(`/repo/src/app-${index}.ts`)
			),
		];

		const filtered = getFilteredFilePickerFiles(files, "app");

		expect(filtered).toHaveLength(FILE_PICKER_RESULT_LIMIT);
		expect(filtered[0]?.path).toBe("/repo/src/app.ts");
		expect(filtered.every((file) => file.path.includes("app"))).toBe(true);
	});

	test("returns first files when query is empty", () => {
		const files = Array.from({ length: FILE_PICKER_RESULT_LIMIT + 3 }, (_, index) =>
			makeFile(`/repo/src/file-${index}.ts`)
		);

		expect(getFilteredFilePickerFiles(files, "")).toHaveLength(
			FILE_PICKER_RESULT_LIMIT
		);
		expect(getFilteredFilePickerFiles(files, "")[0]).toBe(files[0]);
	});

	test("clamps dropdown position inside viewport", () => {
		expect(
			getFilePickerPosition({
				position: { top: 500, left: 2_000 },
				viewportWidth: 1_000,
			})
		).toEqual({
			top: 500 - FILE_PICKER_DROPDOWN_HEIGHT - 8,
			left: 1_000 - FILE_PICKER_DROPDOWN_WIDTH - FILE_PICKER_DROPDOWN_PADDING,
		});
		expect(
			getFilePickerPosition({
				position: { top: 500, left: 1 },
				viewportWidth: 1_000,
			}).left
		).toBe(FILE_PICKER_DROPDOWN_PADDING);
	});

	test("clamps and wraps selected indexes", () => {
		expect(getEffectiveFilePickerIndex({ selectedIndex: 4, fileCount: 0 })).toBe(0);
		expect(getEffectiveFilePickerIndex({ selectedIndex: -1, fileCount: 3 })).toBe(0);
		expect(getEffectiveFilePickerIndex({ selectedIndex: 8, fileCount: 3 })).toBe(2);
		expect(
			getNextFilePickerIndex({ currentIndex: 2, fileCount: 3, direction: "down" })
		).toBe(0);
		expect(
			getNextFilePickerIndex({ currentIndex: 0, fileCount: 3, direction: "up" })
		).toBe(2);
	});

	test("defers preview while searching and otherwise selects active file", () => {
		const files = [makeFile("/repo/src/app.ts")];

		expect(shouldDeferFilePickerPreview("app")).toBe(true);
		expect(shouldDeferFilePickerPreview("   ")).toBe(false);
		expect(
			getFilePickerPreviewFile({
				filteredFiles: files,
				deferPreview: true,
				effectiveSelectedIndex: 0,
			})
		).toBeNull();
		expect(
			getFilePickerPreviewFile({
				filteredFiles: files,
				deferPreview: false,
				effectiveSelectedIndex: 0,
			})
		).toBe(files[0]);
	});
});
