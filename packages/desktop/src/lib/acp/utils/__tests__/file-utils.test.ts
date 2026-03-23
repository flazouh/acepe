import { describe, expect, it } from "bun:test";

import {
	calculateDiffStats,
	extractLineNumbers,
	findGitStatusForFile,
	getFileExtension,
	getFileName,
	getRelativeFilePath,
} from "../file-utils.js";

describe("extractLineNumbers", () => {
	describe("line argument", () => {
		it("should extract single line number", () => {
			expect(extractLineNumbers({ line: 42 })).toBe("42");
		});

		it("should extract line as string", () => {
			expect(extractLineNumbers({ line: "100" })).toBe("100");
		});
	});

	describe("lines argument", () => {
		it("should extract lines string", () => {
			expect(extractLineNumbers({ lines: "1-50" })).toBe("1-50");
		});

		it("should extract single element array", () => {
			expect(extractLineNumbers({ lines: [10] })).toBe("10");
		});

		it("should extract range from array", () => {
			expect(extractLineNumbers({ lines: [10, 20, 30] })).toBe("10-30");
		});
	});

	describe("start_line and end_line arguments", () => {
		it("should extract range from start_line and end_line", () => {
			expect(extractLineNumbers({ start_line: 5, end_line: 15 })).toBe("5-15");
		});

		it("should return single line when start equals end", () => {
			expect(extractLineNumbers({ start_line: 7, end_line: 7 })).toBe("7");
		});
	});

	describe("offset and limit arguments (Claude Code format)", () => {
		it("should convert offset and limit to 1-indexed line range", () => {
			// offset: 115 (0-indexed) means start at line 116
			// limit: 130 means read 130 lines, so end at line 245
			expect(extractLineNumbers({ offset: 115, limit: 130 })).toBe("116-245");
		});

		it("should handle offset 0 with limit", () => {
			// offset: 0 means start at line 1
			// limit: 100 means read 100 lines, so end at line 100
			expect(extractLineNumbers({ offset: 0, limit: 100 })).toBe("1-100");
		});

		it("should handle only offset provided", () => {
			expect(extractLineNumbers({ offset: 50 })).toBe("from 51");
		});

		it("should handle only limit provided", () => {
			expect(extractLineNumbers({ limit: 200 })).toBe("1-200");
		});

		it("should handle real-world example from user data", () => {
			// From user's data: offset: 115, limit: 130
			const args = {
				file_path:
					"/Users/alex/Documents/fluentai/packages/extension/src/common/components/bottom-control-bar/neural-subs-button.tsx",
				limit: 130,
				offset: 115,
			};
			expect(extractLineNumbers(args)).toBe("116-245");
		});

		it("should handle small offset and limit", () => {
			expect(extractLineNumbers({ offset: 0, limit: 50 })).toBe("1-50");
		});

		it("should handle large values", () => {
			expect(extractLineNumbers({ offset: 999, limit: 100 })).toBe("1000-1099");
		});
	});

	describe("edge cases", () => {
		it("should return null for empty object", () => {
			expect(extractLineNumbers({})).toBe(null);
		});

		it("should return null for null/undefined", () => {
			expect(extractLineNumbers(null as unknown as Record<string, unknown>)).toBe(null);
			expect(extractLineNumbers(undefined as unknown as Record<string, unknown>)).toBe(null);
		});

		it("should return null for non-object", () => {
			expect(extractLineNumbers("string" as unknown as Record<string, unknown>)).toBe(null);
		});

		it("should ignore non-numeric offset", () => {
			expect(extractLineNumbers({ offset: "abc" })).toBe(null);
		});

		it("should ignore non-numeric limit", () => {
			expect(extractLineNumbers({ limit: "abc" })).toBe(null);
		});
	});
});

describe("getFileName", () => {
	it("should extract filename from path", () => {
		expect(getFileName("/Users/alex/Documents/file.ts")).toBe("file.ts");
	});

	it("should handle path with multiple segments", () => {
		expect(getFileName("/a/b/c/d/myfile.tsx")).toBe("myfile.tsx");
	});

	it("should return path if no slashes", () => {
		expect(getFileName("file.txt")).toBe("file.txt");
	});

	it("should return empty string for null/undefined", () => {
		expect(getFileName(null)).toBe("");
		expect(getFileName(undefined)).toBe("");
	});
});

describe("getFileExtension", () => {
	it("should extract extension from filename", () => {
		expect(getFileExtension("file.ts")).toBe("ts");
	});

	it("should extract extension from full path", () => {
		expect(getFileExtension("/path/to/file.tsx")).toBe("tsx");
	});

	it("should handle multiple dots", () => {
		expect(getFileExtension("file.test.ts")).toBe("ts");
	});

	it("should return empty string for no extension", () => {
		expect(getFileExtension("Makefile")).toBe("");
	});

	it("should return empty string for null/undefined", () => {
		expect(getFileExtension(null)).toBe("");
		expect(getFileExtension(undefined)).toBe("");
	});
});

describe("getRelativeFilePath", () => {
	describe("absolute path conversion", () => {
		it("should convert absolute path to relative by stripping project path", () => {
			const filePath = "/Users/alex/Documents/acepe/packages/desktop/src/lib/file.ts";
			const projectPath = "/Users/alex/Documents/acepe";
			expect(getRelativeFilePath(filePath, projectPath)).toBe("packages/desktop/src/lib/file.ts");
		});

		it("should handle project path with trailing slash", () => {
			const filePath = "/Users/alex/project/src/index.ts";
			const projectPath = "/Users/alex/project/";
			expect(getRelativeFilePath(filePath, projectPath)).toBe("src/index.ts");
		});

		it("should handle nested paths correctly", () => {
			const filePath = "/Users/alex/Documents/acepe/packages/desktop/src-tauri/src/acp/provider.rs";
			const projectPath = "/Users/alex/Documents/acepe";
			expect(getRelativeFilePath(filePath, projectPath)).toBe(
				"packages/desktop/src-tauri/src/acp/provider.rs"
			);
		});
	});

	describe("already relative paths", () => {
		it("should return relative path unchanged", () => {
			const filePath = "src/lib/file.ts";
			const projectPath = "/Users/alex/project";
			expect(getRelativeFilePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});

		it("should return path unchanged if not under project path", () => {
			const filePath = "/other/path/file.ts";
			const projectPath = "/Users/alex/project";
			expect(getRelativeFilePath(filePath, projectPath)).toBe("/other/path/file.ts");
		});
	});

	describe("edge cases", () => {
		it("should return null for null filePath", () => {
			expect(getRelativeFilePath(null, "/Users/alex/project")).toBe(null);
		});

		it("should return null for undefined filePath", () => {
			expect(getRelativeFilePath(undefined, "/Users/alex/project")).toBe(null);
		});

		it("should return null for null projectPath", () => {
			expect(getRelativeFilePath("/Users/alex/project/file.ts", null)).toBe(null);
		});

		it("should return null for undefined projectPath", () => {
			expect(getRelativeFilePath("/Users/alex/project/file.ts", undefined)).toBe(null);
		});

		it("should return null when both are null", () => {
			expect(getRelativeFilePath(null, null)).toBe(null);
		});

		it("should handle file at project root", () => {
			const filePath = "/Users/alex/project/file.ts";
			const projectPath = "/Users/alex/project";
			expect(getRelativeFilePath(filePath, projectPath)).toBe("file.ts");
		});

		it("should handle empty relative path (file path equals project path)", () => {
			const filePath = "/Users/alex/project";
			const projectPath = "/Users/alex/project";
			expect(getRelativeFilePath(filePath, projectPath)).toBe("");
		});
	});
});

describe("findGitStatusForFile", () => {
	it("finds git status when file path is absolute and status path is relative", () => {
		const result = findGitStatusForFile(
			[
				{
					path: "packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte",
					status: "M",
					insertions: 12,
					deletions: 3,
				},
			],
			"/Users/alex/Documents/acepe/packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte",
			"/Users/alex/Documents/acepe"
		);

		expect(result).toEqual({
			path: "packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte",
			status: "M",
			insertions: 12,
			deletions: 3,
		});
	});

	it("finds git status when file path is already relative", () => {
		const result = findGitStatusForFile(
			[
				{
					path: "src/main.ts",
					status: "M",
					insertions: 2,
					deletions: 1,
				},
			],
			"src/main.ts",
			"/Users/alex/Documents/acepe"
		);

		expect(result?.path).toBe("src/main.ts");
	});

	it("returns null when no matching status exists", () => {
		const result = findGitStatusForFile(
			[
				{
					path: "src/other.ts",
					status: "M",
					insertions: 1,
					deletions: 0,
				},
			],
			"src/main.ts",
			"/Users/alex/Documents/acepe"
		);

		expect(result).toBe(null);
	});

	it("finds status when backend returns repo-root path for nested project files", () => {
		const result = findGitStatusForFile(
			[
				{
					path: "nested/src/main.ts",
					status: "M",
					insertions: 7,
					deletions: 2,
				},
			],
			"src/main.ts",
			"/Users/alex/Documents/repo/nested"
		);

		expect(result).toEqual({
			path: "nested/src/main.ts",
			status: "M",
			insertions: 7,
			deletions: 2,
		});
	});

	it("returns null when suffix matching is ambiguous", () => {
		const result = findGitStatusForFile(
			[
				{ path: "nested-a/src/main.ts", status: "M", insertions: 1, deletions: 0 },
				{ path: "nested-b/src/main.ts", status: "M", insertions: 2, deletions: 0 },
			],
			"src/main.ts",
			"/Users/alex/Documents/repo/nested"
		);

		expect(result).toBe(null);
	});
});

describe("calculateDiffStats", () => {
	it("should calculate actual added lines when appending to file", () => {
		const result = calculateDiffStats({
			old_string: "line1\nline2",
			new_string: "line1\nline2\nline3\nline4",
		});
		// line1 and line2 are common, line3 and line4 are new
		expect(result).toEqual({ added: 2, removed: 0 });
	});

	it("should calculate actual removed lines when deleting from file", () => {
		const result = calculateDiffStats({
			old_string: "line1\nline2\nline3\nline4",
			new_string: "line1\nline2",
		});
		// line1 and line2 are common, line3 and line4 were removed
		expect(result).toEqual({ added: 0, removed: 2 });
	});

	it("should calculate stats for line modification", () => {
		const result = calculateDiffStats({
			old_string: "const x = 1;",
			new_string: "const x = 2;",
		});
		// One line changed (old removed, new added)
		expect(result).toEqual({ added: 1, removed: 1 });
	});

	it("should calculate stats for single line insertion in multi-line context", () => {
		const result = calculateDiffStats({
			old_string: "line1\nline2\nline3",
			new_string: "line1\nline2\nnew line\nline3",
		});
		// line1, line2, line3 are common, "new line" is added
		expect(result).toEqual({ added: 1, removed: 0 });
	});

	it("should calculate stats from content alone", () => {
		const result = calculateDiffStats({
			content: "line1\nline2\nline3",
		});
		expect(result).toEqual({ added: 3, removed: 0 });
	});

	it("should return null for empty object", () => {
		expect(calculateDiffStats({})).toBe(null);
	});

	it("should return null for null/undefined", () => {
		expect(calculateDiffStats(null as unknown as Record<string, unknown>)).toBe(null);
	});
});
