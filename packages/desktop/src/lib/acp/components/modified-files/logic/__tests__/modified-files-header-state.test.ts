import { describe, expect, it } from "bun:test";
import type { ModifiedFileEntry } from "../../../../types/modified-file-entry.js";
import type { ModifiedFilesState } from "../../../../types/modified-files-state.js";
import {
	canKeepAllFiles,
	countReviewedFiles,
	getModifiedFilesDiffTotals,
	getPromptEditorState,
	isModifiedFilesReviewComplete,
	mapReviewStatusForHeader,
} from "../modified-files-header-state.js";
import type { FileReviewStatus } from "../../../review-panel/review-session-state.js";

function makeFile(filePath: string, totalAdded: number, totalRemoved: number): ModifiedFileEntry {
	return {
		filePath,
		fileName: filePath.split("/").at(-1) ?? filePath,
		totalAdded,
		totalRemoved,
		originalContent: null,
		finalContent: null,
		editCount: 1,
	};
}

function makeModifiedFilesState(files: ModifiedFileEntry[]): ModifiedFilesState {
	return {
		files,
		byPath: new Map(files.map((file) => [file.filePath, file])),
		fileCount: files.length,
		totalEditCount: files.length,
	};
}

describe("modified files header state", () => {
	it("sums diff totals from the current modified files", () => {
		const state = makeModifiedFilesState([
			makeFile("src/one.ts", 3, 1),
			makeFile("src/two.ts", 5, 2),
		]);

		expect(getModifiedFilesDiffTotals(state)).toEqual({
			totalAdded: 8,
			totalRemoved: 3,
		});
		expect(getModifiedFilesDiffTotals(null)).toEqual({
			totalAdded: 0,
			totalRemoved: 0,
		});
	});

	it("counts only reviewed files as reviewed", () => {
		const state = makeModifiedFilesState([
			makeFile("src/reviewed-a.ts", 1, 0),
			makeFile("src/reviewed-b.ts", 1, 0),
			makeFile("src/unreviewed-a.ts", 1, 0),
			makeFile("src/unreviewed-b.ts", 1, 0),
		]);
		const statuses = new Map<string, FileReviewStatus | undefined>([
			["src/reviewed-a.ts", "reviewed"],
			["src/reviewed-b.ts", "reviewed"],
			["src/unreviewed-a.ts", "unreviewed"],
		]);

		expect(countReviewedFiles(state, statuses)).toBe(2);
		expect(countReviewedFiles(null, statuses)).toBe(0);
	});

	it("marks review complete only when a non-empty file set is fully reviewed", () => {
		const state = makeModifiedFilesState([makeFile("src/one.ts", 1, 0)]);
		const emptyState = makeModifiedFilesState([]);

		expect(isModifiedFilesReviewComplete(state, 1)).toBe(true);
		expect(isModifiedFilesReviewComplete(state, 0)).toBe(false);
		expect(isModifiedFilesReviewComplete(emptyState, 0)).toBe(false);
		expect(isModifiedFilesReviewComplete(null, 0)).toBe(false);
	});

	it("allows keep all only after review state is loaded and not already applied", () => {
		expect(
			canKeepAllFiles({
				sessionId: "session-1",
				isSessionReviewLoaded: true,
				isKeepAllApplied: false,
			})
		).toBe(true);
		expect(
			canKeepAllFiles({
				sessionId: null,
				isSessionReviewLoaded: true,
				isKeepAllApplied: false,
			})
		).toBe(false);
		expect(
			canKeepAllFiles({
				sessionId: "session-1",
				isSessionReviewLoaded: false,
				isKeepAllApplied: false,
			})
		).toBe(false);
		expect(
			canKeepAllFiles({
				sessionId: "session-1",
				isSessionReviewLoaded: true,
				isKeepAllApplied: true,
			})
		).toBe(false);
	});

	it("maps review status to the header reviewed/unreviewed state", () => {
		expect(mapReviewStatusForHeader("reviewed")).toBe("reviewed");
		expect(mapReviewStatusForHeader("unreviewed")).toBe("unreviewed");
		expect(mapReviewStatusForHeader(undefined)).toBe("unreviewed");
	});

	it("builds prompt editor labels and save/reset state", () => {
		expect(
			getPromptEditorState({
				savedPrompt: "  Use short text  ",
				hasPromptDraft: false,
				promptDraft: "",
			})
		).toMatchObject({
			baseline: "Use short text",
			value: "Use short text",
			canSave: false,
			canReset: true,
			statusLabel: "Custom",
		});

		expect(
			getPromptEditorState({
				savedPrompt: null,
				hasPromptDraft: true,
				promptDraft: "New prompt",
			})
		).toMatchObject({
			value: "New prompt",
			hasUnsavedChanges: true,
			canSave: true,
			canReset: true,
			statusLabel: "Unsaved draft",
		});

		expect(
			getPromptEditorState({
				savedPrompt: null,
				hasPromptDraft: false,
				promptDraft: "",
			})
		).toMatchObject({
			canSave: false,
			canReset: false,
			statusLabel: "Default",
		});
	});
});
