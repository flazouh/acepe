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
	const gamma = {
		filePath: "src/lib/gamma.ts",
		fileName: "gamma.ts",
		totalAdded: 7,
		totalRemoved: 4,
		originalContent: "gamma old",
		finalContent: "gamma new",
		editCount: 1,
	};
	const delta = {
		filePath: "src/lib/delta.ts",
		fileName: "delta.ts",
		totalAdded: 1,
		totalRemoved: 5,
		originalContent: "delta old",
		finalContent: "delta new",
		editCount: 1,
	};

	return {
		files: [alpha, beta, gamma, delta],
		byPath: new Map([
			[alpha.filePath, alpha],
			[beta.filePath, beta],
			[gamma.filePath, gamma],
			[delta.filePath, delta],
		]),
		fileCount: 4,
		totalEditCount: 4,
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
				["src/lib/alpha.ts", "reviewed"],
				["src/lib/beta.ts", "reviewed"],
			])
		);

		expect(rows).toEqual([
			{
				id: "src/lib/gamma.ts",
				filePath: "src/lib/gamma.ts",
				fileName: "gamma.ts",
				sourceIndex: 2,
				reviewStatus: "unreviewed",
				additions: 7,
				deletions: 4,
			},
			{
				id: "src/lib/delta.ts",
				filePath: "src/lib/delta.ts",
				fileName: "delta.ts",
				sourceIndex: 3,
				reviewStatus: "unreviewed",
				additions: 1,
				deletions: 5,
			},
			{
				id: "src/lib/alpha.ts",
				filePath: "src/lib/alpha.ts",
				fileName: "alpha.ts",
				sourceIndex: 0,
				reviewStatus: "reviewed",
				additions: 12,
				deletions: 2,
			},
			{
				id: "src/lib/beta.ts",
				filePath: "src/lib/beta.ts",
				fileName: "beta.ts",
				sourceIndex: 1,
				reviewStatus: "reviewed",
				additions: 3,
				deletions: 1,
			},
		]);
	});

	it("orders unreviewed files before reviewed files, stable by source index", () => {
		const rows = buildReviewWorkspaceFiles(
			createReviewFilesState(),
			new Map([
				["src/lib/alpha.ts", "reviewed"],
				["src/lib/beta.ts", "reviewed"],
				["src/lib/gamma.ts", "unreviewed"],
				["src/lib/delta.ts", undefined],
			])
		);

		expect(rows.map((row) => row.fileName)).toEqual([
			"gamma.ts",
			"delta.ts",
			"alpha.ts",
			"beta.ts",
		]);
		expect(rows.map((row) => row.sourceIndex)).toEqual([2, 3, 0, 1]);
	});

	it("defaults review entry selection to the first unreviewed file from persisted review state", () => {
		isLoaded.mockReturnValue(true);
		getState.mockReturnValue({});
		getReviewStatusByFilePath.mockReturnValue(
			new Map([
				["src/lib/alpha.ts", "reviewed"],
				["src/lib/beta.ts", undefined],
				["src/lib/gamma.ts", "reviewed"],
				["src/lib/delta.ts", "reviewed"],
			])
		);

		expect(resolveInitialReviewWorkspaceIndex(createReviewFilesState(), "session-1")).toBe(1);
	});

	it("falls back to the first file when persisted review state is unavailable", () => {
		isLoaded.mockReturnValue(false);

		expect(resolveInitialReviewWorkspaceIndex(createReviewFilesState(), "session-1")).toBe(0);
	});
});
