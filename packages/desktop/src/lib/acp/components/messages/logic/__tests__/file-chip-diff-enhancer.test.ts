import { describe, expect, it } from "bun:test";
import type { ModifiedFilesState } from "$lib/acp/types/modified-files-state.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";

import {
	normalizeToProjectRelativePath,
	resolveDiffStatsForFilePath,
} from "../file-chip-diff-enhancer.js";

function createSessionState(
	filePath: string,
	totalAdded: number,
	totalRemoved: number
): ModifiedFilesState {
	const entry = {
		filePath,
		fileName: filePath.split("/").pop() ?? filePath,
		totalAdded,
		totalRemoved,
		originalContent: null,
		finalContent: null,
		editCount: 1,
	} as const;

	return {
		files: [entry],
		byPath: new Map([[filePath, entry]]),
		fileCount: 1,
		totalEditCount: 1,
	};
}

describe("normalizeToProjectRelativePath", () => {
	it("normalizes absolute paths inside the project", () => {
		expect(
			normalizeToProjectRelativePath(
				"/Users/alex/Documents/acepe/packages/desktop/src/lib/file.ts",
				"/Users/alex/Documents/acepe/packages/desktop"
			)
		).toBe("src/lib/file.ts");
	});

	it("normalizes monorepo style paths", () => {
		expect(
			normalizeToProjectRelativePath(
				"/packages/desktop/src/lib/file.ts",
				"/Users/alex/Documents/acepe/packages/desktop"
			)
		).toBe("src/lib/file.ts");
	});
});

describe("resolveDiffStatsForFilePath", () => {
	it("returns git diff stats when git status exists", () => {
		const gitStatusByPath = new Map<string, FileGitStatus>([
			[
				"src/lib/file.ts",
				{
					path: "src/lib/file.ts",
					status: "M",
					insertions: 7,
					deletions: 3,
				},
			],
		]);

		const stats = resolveDiffStatsForFilePath("src/lib/file.ts", {
			projectPath: "/Users/alex/Documents/acepe/packages/desktop",
			gitStatusByPath,
		});

		expect(stats).toEqual({ insertions: 7, deletions: 3 });
	});

	it("falls back to session totals when git status is missing", () => {
		const stats = resolveDiffStatsForFilePath("src/lib/file.ts", {
			sessionState: createSessionState("src/lib/file.ts", 2, 1),
		});

		expect(stats).toEqual({ insertions: 2, deletions: 1 });
	});

	it("prefers git status over session totals", () => {
		const gitStatusByPath = new Map<string, FileGitStatus>([
			[
				"src/lib/file.ts",
				{
					path: "src/lib/file.ts",
					status: "M",
					insertions: 10,
					deletions: 6,
				},
			],
		]);

		const stats = resolveDiffStatsForFilePath("src/lib/file.ts", {
			projectPath: "/Users/alex/Documents/acepe/packages/desktop",
			gitStatusByPath,
			sessionState: createSessionState("src/lib/file.ts", 1, 1),
		});

		expect(stats).toEqual({ insertions: 10, deletions: 6 });
	});

	it("returns null when changes are zero", () => {
		const gitStatusByPath = new Map<string, FileGitStatus>([
			[
				"src/lib/file.ts",
				{
					path: "src/lib/file.ts",
					status: "M",
					insertions: 0,
					deletions: 0,
				},
			],
		]);

		const stats = resolveDiffStatsForFilePath("src/lib/file.ts", {
			projectPath: "/Users/alex/Documents/acepe/packages/desktop",
			gitStatusByPath,
		});

		expect(stats).toBeNull();
	});

	it("resolves absolute and monorepo-style file paths", () => {
		const gitStatusByPath = new Map<string, FileGitStatus>([
			[
				"src/lib/file.ts",
				{
					path: "src/lib/file.ts",
					status: "M",
					insertions: 4,
					deletions: 1,
				},
			],
		]);

		const stats = resolveDiffStatsForFilePath("/packages/desktop/src/lib/file.ts", {
			projectPath: "/Users/alex/Documents/acepe/packages/desktop",
			gitStatusByPath,
		});

		expect(stats).toEqual({ insertions: 4, deletions: 1 });
	});
});
