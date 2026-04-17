import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModifiedFilesState } from "../../../types/modified-files-state.js";

const { getReviewStatusByFilePath, getState, isLoaded } = vi.hoisted(() => ({
	isLoaded: vi.fn<(sessionId: string) => boolean>(),
	getState: vi.fn<(sessionId: string) => object>(),
	getReviewStatusByFilePath: vi.fn(),
}));

vi.mock("../../../store/session-review-state-store.svelte.js", () => ({
	sessionReviewStateStore: {
		isLoaded,
		getState,
	},
}));

vi.mock("../../modified-files/logic/review-progress.js", () => ({
	getReviewStatusByFilePath,
}));

import {
	buildReviewWorkspaceFiles,
	resolveInitialReviewWorkspaceIndex,
} from "./review-workspace-model.js";

function createReviewFilesState(): ModifiedFilesState {
	const alpha = {
		filePath: "src/lib/alpha.ts",
		fileName: "alpha.ts",
		totalAdded: 12,
		totalRemoved: 2,
		originalContent: "alpha old",
		finalContent: "alpha new",
		editCount: 1,
	};
	const beta = {
		filePath: "src/lib/beta.ts",
		fileName: "beta.ts",
		totalAdded: 3,
		totalRemoved: 1,
		originalContent: "beta old",
		finalContent: "beta new",
		editCount: 1,
	};

	return {
		files: [alpha, beta],
		byPath: new Map([
			[alpha.filePath, alpha],
			[beta.filePath, beta],
		]),
		fileCount: 2,
		totalEditCount: 2,
	};
}

describe("review-workspace-model", () => {
	beforeEach(() => {
		isLoaded.mockReset();
		getState.mockReset();
		getReviewStatusByFilePath.mockReset();
	});

	it("maps modified files into workspace rows with review metadata", () => {
		const rows = buildReviewWorkspaceFiles(
			createReviewFilesState(),
			new Map([
				["src/lib/alpha.ts", "accepted"],
				["src/lib/beta.ts", "partial"],
			])
		);

		expect(rows).toEqual([
			{
				id: "src/lib/alpha.ts",
				filePath: "src/lib/alpha.ts",
				fileName: "alpha.ts",
				reviewStatus: "accepted",
				additions: 12,
				deletions: 2,
			},
			{
				id: "src/lib/beta.ts",
				filePath: "src/lib/beta.ts",
				fileName: "beta.ts",
				reviewStatus: "partial",
				additions: 3,
				deletions: 1,
			},
		]);
	});

	it("defaults review entry selection to the first unresolved file from persisted review state", () => {
		isLoaded.mockReturnValue(true);
		getState.mockReturnValue({});
		getReviewStatusByFilePath.mockReturnValue(
			new Map([
				["src/lib/alpha.ts", "accepted"],
				["src/lib/beta.ts", undefined],
			])
		);

		expect(resolveInitialReviewWorkspaceIndex(createReviewFilesState(), "session-1")).toBe(1);
	});

	it("falls back to the first file when persisted review state is unavailable", () => {
		isLoaded.mockReturnValue(false);

		expect(resolveInitialReviewWorkspaceIndex(createReviewFilesState(), "session-1")).toBe(0);
	});
});
