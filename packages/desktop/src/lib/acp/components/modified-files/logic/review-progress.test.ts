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

function createProgress(
	filePath: string,
	status: PersistedFileReviewProgress["status"]
): PersistedFileReviewProgress {
	return {
		filePath,
		status,
		acceptedHunks: status === "accepted" ? 1 : 0,
		rejectedHunks: status === "denied" ? 1 : 0,
		pendingHunks: status === "partial" ? 1 : 0,
		totalHunks: 1,
		resolvedActions:
			status === "accepted"
				? [{ hunkIndex: 0, action: "accept" }]
				: status === "denied"
					? [{ hunkIndex: 0, action: "reject" }]
					: [],
	};
}

function createState(
	entries: ReadonlyArray<{
		file: ModifiedFileEntry;
		status: PersistedFileReviewProgress["status"];
	}>
): SessionReviewState {
	const filesByRevisionKey: Record<string, PersistedFileReviewProgress> = {};

	for (const entry of entries) {
		filesByRevisionKey[createReviewFileRevisionKey(entry.file)] = createProgress(
			entry.file.filePath,
			entry.status
		);
	}

	return {
		version: 1,
		filesByRevisionKey,
	};
}

describe("review progress", () => {
	it("maps persisted statuses to the current file revisions", () => {
		const state = createState([
			{ file: alphaFile, status: "accepted" },
			{ file: betaFile, status: "partial" },
		]);

		const statusByFilePath = getReviewStatusByFilePath([alphaFile, betaFile], state);

		expect(statusByFilePath.get(alphaFile.filePath)).toBe("accepted");
		expect(statusByFilePath.get(betaFile.filePath)).toBe("partial");
	});

	it("reports keep-all as applied only when every current file revision is accepted", () => {
		const appliedState = createState([
			{ file: alphaFile, status: "accepted" },
			{ file: betaFile, status: "accepted" },
		]);
		const partialState = createState([
			{ file: alphaFile, status: "accepted" },
			{ file: betaFile, status: "partial" },
		]);

		expect(hasKeepAllBeenApplied([alphaFile, betaFile], appliedState)).toBe(true);
		expect(hasKeepAllBeenApplied([alphaFile, betaFile], partialState)).toBe(false);
		expect(hasKeepAllBeenApplied([alphaFile, betaFile], null)).toBe(false);
		expect(hasKeepAllBeenApplied([], appliedState)).toBe(false);
	});
});
