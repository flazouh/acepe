import { describe, expect, it } from "bun:test";
import type { Checkpoint, FileSnapshot } from "../../types/checkpoint.js";
import {
	buildCheckpointCardData,
	buildCheckpointDiffLoadedState,
	buildCheckpointDiffLoadFailedState,
	buildCheckpointDiffLoadingState,
	buildCheckpointDiffToggleState,
	buildCheckpointFileRevertState,
	buildCheckpointFiles,
	getCheckpointFileName,
	getCheckpointLanguageFromPath,
	getDefaultCheckpointFileRowState,
} from "./checkpoint-card-state.js";

function makeCheckpoint(): Checkpoint {
	return {
		id: "checkpoint-1",
		sessionId: "session-1",
		checkpointNumber: 2,
		name: null,
		createdAt: 123,
		toolCallId: null,
		isAuto: true,
		fileCount: 3,
		totalLinesAdded: 8,
		totalLinesRemoved: 4,
	};
}

function makeFileSnapshot(input: Partial<FileSnapshot> & Pick<FileSnapshot, "id">): FileSnapshot {
	return {
		id: input.id,
		checkpointId: input.checkpointId ?? "checkpoint-1",
		filePath: input.filePath ?? "src/app.ts",
		contentHash: input.contentHash ?? "hash",
		fileSize: input.fileSize ?? 100,
		linesAdded: input.linesAdded ?? 0,
		linesRemoved: input.linesRemoved ?? 0,
	};
}

describe("checkpoint card state", () => {
	it("builds UI checkpoint data from a checkpoint", () => {
		expect(
			buildCheckpointCardData({
				checkpoint: makeCheckpoint(),
				userMessagePreview: "changed files",
			})
		).toEqual({
			id: "checkpoint-1",
			number: 2,
			message: "changed files",
			timestamp: 123,
			fileCount: 3,
			totalInsertions: 8,
			totalDeletions: 4,
			isAuto: true,
		});
	});

	it("keeps only files with visible line changes", () => {
		expect(
			buildCheckpointFiles([
				makeFileSnapshot({ id: "added", filePath: "src/a.ts", linesAdded: 2 }),
				makeFileSnapshot({ id: "removed", filePath: "src/b.ts", linesRemoved: 1 }),
				makeFileSnapshot({ id: "unchanged", filePath: "src/c.ts" }),
				makeFileSnapshot({ id: "unknown", filePath: "src/d.ts", linesAdded: null, linesRemoved: null }),
			])
		).toEqual([
			{
				id: "added",
				filePath: "src/a.ts",
				linesAdded: 2,
				linesRemoved: 0,
				fileSize: 100,
			},
			{
				id: "removed",
				filePath: "src/b.ts",
				linesAdded: 0,
				linesRemoved: 1,
				fileSize: 100,
			},
		]);
	});

	it("builds default row state for a file", () => {
		expect(getDefaultCheckpointFileRowState()).toEqual({
			isDiffExpanded: false,
			isLoadingDiff: false,
			isReverting: false,
			diff: null,
		});
	});

	it("builds file revert row states without changing other fields", () => {
		const currentState = {
			isDiffExpanded: true,
			isLoadingDiff: false,
			isReverting: false,
			diff: {
				filePath: "src/app.ts",
				content: "after",
				oldContent: "before",
				language: "typescript",
			},
		};

		expect(buildCheckpointFileRevertState(currentState, true)).toEqual({
			...currentState,
			isReverting: true,
		});
		expect(buildCheckpointFileRevertState(undefined, true)).toEqual({
			isDiffExpanded: false,
			isLoadingDiff: false,
			isReverting: true,
			diff: null,
		});
	});

	it("builds diff loading, loaded, failed, and toggle states", () => {
		expect(buildCheckpointDiffLoadingState()).toEqual({
			isDiffExpanded: true,
			isLoadingDiff: true,
			isReverting: false,
			diff: null,
		});
		expect(
			buildCheckpointDiffLoadedState({
				filePath: "src/app.ts",
				oldContent: "before",
				newContent: "after",
			})
		).toEqual({
			isDiffExpanded: true,
			isLoadingDiff: false,
			isReverting: false,
			diff: {
				filePath: "src/app.ts",
				content: "after",
				oldContent: "before",
				language: "typescript",
			},
		});
		expect(buildCheckpointDiffLoadFailedState()).toEqual({
			isDiffExpanded: true,
			isLoadingDiff: false,
			isReverting: false,
			diff: null,
		});
		expect(
			buildCheckpointDiffToggleState({
				currentState: {
					isDiffExpanded: true,
					isLoadingDiff: true,
					isReverting: true,
					diff: null,
				},
				isDiffExpanded: false,
			})
		).toEqual({
			isDiffExpanded: false,
			isLoadingDiff: false,
			isReverting: true,
			diff: null,
		});
	});

	it("extracts file names from paths", () => {
		expect(getCheckpointFileName("src/components/card.svelte")).toBe("card.svelte");
		expect(getCheckpointFileName("README.md")).toBe("README.md");
	});

	it("maps common file extensions to preview languages", () => {
		expect(getCheckpointLanguageFromPath("src/app.ts")).toBe("typescript");
		expect(getCheckpointLanguageFromPath("src/app.tsx")).toBe("typescript");
		expect(getCheckpointLanguageFromPath("src/main.rs")).toBe("rust");
		expect(getCheckpointLanguageFromPath("README.md")).toBe("markdown");
		expect(getCheckpointLanguageFromPath("unknown.bin")).toBe("text");
	});
});
