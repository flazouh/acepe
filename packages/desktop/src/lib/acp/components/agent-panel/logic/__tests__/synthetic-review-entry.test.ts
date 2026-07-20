import { describe, expect, it } from "bun:test";
import type { ModifiedFileEntry } from "../../../../types/modified-file-entry.js";
import type { ModifiedFilesState } from "../../../../types/modified-files-state.js";
import { createSyntheticReviewEntry } from "../synthetic-review-entry.js";

function createModifiedFile(
	filePath: string,
	totalAdded: number,
	totalRemoved: number
): ModifiedFileEntry {
	return {
		filePath,
		fileName: filePath.split("/").at(-1) ?? filePath,
		totalAdded,
		totalRemoved,
		originalContent: "",
		finalContent: "",
		editCount: 1,
	};
}

function createModifiedFilesState(files: readonly ModifiedFileEntry[]): ModifiedFilesState {
	const byPath = new Map<string, ModifiedFileEntry>();
	let totalEditCount = 0;
	for (const file of files) {
		byPath.set(file.filePath, file);
		totalEditCount += file.editCount;
	}

	return {
		files,
		byPath,
		fileCount: files.length,
		totalEditCount,
	};
}

describe("createSyntheticReviewEntry", () => {
	it("returns null while the agent is streaming", () => {
		const entry = createSyntheticReviewEntry({
			turnState: "streaming",
			modifiedFilesState: createModifiedFilesState([createModifiedFile("src/a.ts", 4, 1)]),
		});

		expect(entry).toBeNull();
	});

	it("returns null when there are no edited files", () => {
		const entry = createSyntheticReviewEntry({
			turnState: "idle",
			modifiedFilesState: createModifiedFilesState([]),
		});

		expect(entry).toBeNull();
	});

	it("builds a local review tool call from modified files after streaming", () => {
		const entry = createSyntheticReviewEntry({
			turnState: "completed",
			modifiedFilesState: createModifiedFilesState([
				createModifiedFile("src/a.ts", 4, 1),
				createModifiedFile("src/b.ts", 6, 2),
			]),
		});

		expect(entry).toMatchObject({
			id: "local:review",
			type: "tool_call",
			kind: "review",
			title: "Edited files",
			status: "done",
			reviewFiles: [
				{
					id: "src/a.ts",
					filePath: "src/a.ts",
					fileName: "a.ts",
					additions: 4,
					deletions: 1,
				},
				{
					id: "src/b.ts",
					filePath: "src/b.ts",
					fileName: "b.ts",
					additions: 6,
					deletions: 2,
				},
			],
		});
	});
});
