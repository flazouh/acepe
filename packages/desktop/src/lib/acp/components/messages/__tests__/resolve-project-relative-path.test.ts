/**
 * Path Resolution Logic Tests
 *
 * Tests the path resolution logic used in markdown-text.svelte for file path badges.
 * This function converts various path formats to project-relative paths.
 *
 * Handles three types of paths:
 * 1. Absolute paths within project (e.g., /Users/example/project/src/file.ts)
 * 2. Monorepo-relative paths (e.g., /packages/desktop/src/file.ts)
 * 3. Project-relative paths (e.g., src/file.ts)
 */

import { describe, expect, it } from "vitest";

import { normalizeToProjectRelativePath } from "../logic/file-chip-diff-enhancer.js";

describe("normalizeToProjectRelativePath", () => {
	const projectPath = "/Users/example/Documents/acepe/packages/desktop";

	describe("absolute paths within project", () => {
		it("should strip project path prefix from absolute paths", () => {
			const filePath = "/Users/example/Documents/acepe/packages/desktop/src/lib/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});

		it("should handle deeply nested paths", () => {
			const filePath =
				"/Users/example/Documents/acepe/packages/desktop/src/lib/acp/components/messages/markdown-text.svelte";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe(
				"src/lib/acp/components/messages/markdown-text.svelte"
			);
		});

		it("should handle root-level files", () => {
			const filePath = "/Users/example/Documents/acepe/packages/desktop/package.json";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("package.json");
		});
	});

	describe("monorepo-relative paths (with leading slash)", () => {
		it("should resolve paths that match project path suffix", () => {
			const filePath = "/packages/desktop/src/lib/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});

		it("should resolve deeply nested monorepo paths", () => {
			const filePath =
				"/packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe(
				"src/lib/acp/components/tool-calls/tool-call-router.svelte"
			);
		});

		it("should handle single-level overlap", () => {
			const filePath = "/desktop/src/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/file.ts");
		});
	});

	describe("monorepo-relative paths (without leading slash)", () => {
		it("should resolve paths that match project path suffix", () => {
			const filePath = "packages/desktop/src/lib/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});

		it("should handle partial overlap", () => {
			const filePath = "desktop/src/lib/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});
	});

	describe("project-relative paths", () => {
		it("should return project-relative paths unchanged", () => {
			const filePath = "src/lib/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});

		it("should handle simple filenames", () => {
			const filePath = "package.json";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("package.json");
		});
	});

	describe("paths with no project overlap", () => {
		it("should strip leading slash and return as-is", () => {
			const filePath = "/some/other/path/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("some/other/path/file.ts");
		});

		it("should return paths without leading slash as-is", () => {
			const filePath = "unrelated/path/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("unrelated/path/file.ts");
		});
	});

	describe("edge cases", () => {
		it("should handle exact project path match", () => {
			// Edge case: path is exactly the project path + file
			const filePath = "/Users/example/Documents/acepe/packages/desktop/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("file.ts");
		});

		it("should handle paths with similar but non-matching prefixes", () => {
			// /packages/desktop-app is different from /packages/desktop
			const filePath = "/packages/desktop-app/src/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe(
				"packages/desktop-app/src/file.ts"
			);
		});

		it("should handle empty segments gracefully", () => {
			const filePath = "src//lib/file.ts";
			// Double slash creates empty segment, function should still work
			const result = normalizeToProjectRelativePath(filePath, projectPath);
			expect(result).toBe("src//lib/file.ts");
		});

		it("should work with different project paths", () => {
			const differentProjectPath = "/home/user/myproject";
			const filePath = "/myproject/src/index.ts";
			expect(normalizeToProjectRelativePath(filePath, differentProjectPath)).toBe("src/index.ts");
		});

		it("should handle Windows-style paths on Unix (forward slashes)", () => {
			// If someone pastes a Windows path with forward slashes
			const filePath = "C:/Users/example/project/src/file.ts";
			// No overlap with Unix project path, returns as-is
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe(
				"C:/Users/example/project/src/file.ts"
			);
		});
	});

	describe("real-world scenarios", () => {
		it("should handle the original bug case: tool-call path", () => {
			// Path from tool-calls folder (e.g. from AI or monorepo references)
			const filePath =
				"/packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe(
				"src/lib/acp/components/tool-calls/tool-call-router.svelte"
			);
		});

		it("should handle AI model output paths", () => {
			// AI models often output paths from the root of the repo
			const paths = [
				"/packages/desktop/src/lib/utils/tauri-client.ts",
				"/packages/desktop/src/routes/+page.svelte",
				"/packages/desktop/vite.config.ts",
			];

			expect(normalizeToProjectRelativePath(paths[0], projectPath)).toBe(
				"src/lib/utils/tauri-client.ts"
			);
			expect(normalizeToProjectRelativePath(paths[1], projectPath)).toBe("src/routes/+page.svelte");
			expect(normalizeToProjectRelativePath(paths[2], projectPath)).toBe("vite.config.ts");
		});

		it("should handle git diff style paths", () => {
			// Git often shows paths relative to repo root
			const filePath = "packages/desktop/src/lib/file.ts";
			expect(normalizeToProjectRelativePath(filePath, projectPath)).toBe("src/lib/file.ts");
		});
	});
});
