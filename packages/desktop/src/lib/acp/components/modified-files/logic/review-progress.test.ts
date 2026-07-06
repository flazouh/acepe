import { describe, expect, it } from "bun:test";

import { createReviewFileRevisionKey } from "../../../review/review-file-revision.js";
import type {
	PersistedFileReviewProgress,
	SessionReviewState,
} from "../../../store/session-review-state-store.svelte.js";
import type { ModifiedFileEntry } from "../../../types/modified-file-entry.js";
import { getReviewStatusByFilePath, hasKeepAllBeenApplied } from "./review-progress.js";

const alphaFile: ModifiedFileEntry = {
	filePath: "/repo/src/alpha.ts",
	fileName: "alpha.ts",
	totalAdded: 2,
	totalRemoved: 1,
	originalContent: "const alpha = 1;\n",
	finalContent: "const alpha = 2;\nconst beta = 3;\n",
	editCount: 1,
};

const betaFile: ModifiedFileEntry = {
	filePath: "/repo/src/beta.ts",
	fileName: "beta.ts",
	totalAdded: 1,
	totalRemoved: 0,
	originalContent: "export const beta = 1;\n",
	finalContent: "export const beta = 2;\n",
	editCount: 1,
};

function createProgress(filePath: string, reviewed: boolean): PersistedFileReviewProgress {
	return {
		filePath,
		reviewed,
	};
}

function createState(
	entries: ReadonlyArray<{
		file: ModifiedFileEntry;
		reviewed: boolean;
	}>
): SessionReviewState {
	const filesByRevisionKey: Record<string, PersistedFileReviewProgress> = {};

	for (const entry of entries) {
		filesByRevisionKey[createReviewFileRevisionKey(entry.file)] = createProgress(
			entry.file.filePath,
			entry.reviewed
		);
	}

	return {
		version: 2,
		filesByRevisionKey,
	};
}

describe("review progress", () => {
	it("maps persisted reviewed flags to the current file revisions", () => {
		const state = createState([
			{ file: alphaFile, reviewed: true },
			{ file: betaFile, reviewed: false },
		]);

		const statusByFilePath = getReviewStatusByFilePath([alphaFile, betaFile], state);

		expect(statusByFilePath.get(alphaFile.filePath)).toBe("reviewed");
		expect(statusByFilePath.get(betaFile.filePath)).toBe("unreviewed");
	});

	it("reports keep-all as applied only when every current file revision is reviewed", () => {
		const appliedState = createState([
			{ file: alphaFile, reviewed: true },
			{ file: betaFile, reviewed: true },
		]);
		const partialState = createState([
			{ file: alphaFile, reviewed: true },
			{ file: betaFile, reviewed: false },
		]);

		expect(hasKeepAllBeenApplied([alphaFile, betaFile], appliedState)).toBe(true);
		expect(hasKeepAllBeenApplied([alphaFile, betaFile], partialState)).toBe(false);
		expect(hasKeepAllBeenApplied([alphaFile, betaFile], null)).toBe(false);
		expect(hasKeepAllBeenApplied([], appliedState)).toBe(false);
	});
});
