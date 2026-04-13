import { type FileContents, type FileDiffMetadata, parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs", async () => {
	const actual = await vi.importActual<typeof import("@pierre/diffs")>("@pierre/diffs");
	const diffAcceptRejectHunk: typeof actual.diffAcceptRejectHunk = (diff, hunkIndex, action) => {
		const result = actual.diffAcceptRejectHunk(diff, hunkIndex, action);
		const corruptedResult = Object.assign({}, result);
		Reflect.deleteProperty(corruptedResult, "newLines");
		return corruptedResult;
	};

	return Object.assign({}, actual, {
		diffAcceptRejectHunk,
	});
});

vi.mock("$lib/acp/utils/worker-pool-singleton.js", () => ({
	getWorkerPool: (): undefined => undefined,
}));

vi.mock("../diff-hunk-action-buttons.svelte", () => ({
	default: class MockDiffHunkActionButtons {},
}));

type ReviewDiffData = {
	readonly oldFile: FileContents;
	readonly newFile: FileContents;
	readonly fileDiffMetadata: FileDiffMetadata;
};

type RenderArgs = {
	fileDiff: FileDiffMetadata;
};

function createSingleHunkDiffData(): ReviewDiffData {
	const oldFile: FileContents = {
		name: "example.ts",
		contents: ["line-01", "line-02", "line-03"].join("\n"),
		cacheKey: "single-old",
	};
	const newFile: FileContents = {
		name: "example.ts",
		contents: ["line-01", "line-02-modified", "line-03"].join("\n"),
		cacheKey: "single-new",
	};

	return {
		oldFile,
		newFile,
		fileDiffMetadata: parseDiffFromFile(oldFile, newFile),
	};
}

async function setupState() {
	const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
	const state = new ReviewDiffViewState();
	const diffData = createSingleHunkDiffData();

	const fakeFileDiffInstance = {
		render(_args: RenderArgs): void {},
	};

	Reflect.set(state, "currentDiffData", diffData);
	Reflect.set(state, "containerElement", document.createElement("div"));
	Reflect.set(state, "fileDiffInstance", fakeFileDiffInstance);

	return { state, diffData };
}

describe("ReviewDiffViewState regression", () => {
	it("keeps accepted contents when resolved metadata omits newLines", async () => {
		const { state, diffData } = await setupState();
		const originalNewContents = diffData.newFile.contents;

		expect(() => {
			state.applyHunkAction(0, "accept");
		}).not.toThrow();

		const currentData = Reflect.get(state, "currentDiffData") as ReviewDiffData;
		expect(currentData.newFile.contents).toBe(originalNewContents);
	});

	it("extracts old content from legacy numeric hunk payloads", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();

		const legacyMetadata = {
			name: "example.ts",
			prevName: undefined,
			type: "change",
			hunks: [
				{
					collapsedBefore: 0,
					splitLineStart: 1,
					splitLineCount: 1,
					unifiedLineStart: 1,
					unifiedLineCount: 1,
					additionCount: 1,
					additionStart: 2,
					additionLines: 1,
					deletionCount: 1,
					deletionStart: 2,
					deletionLines: 1,
					hunkContent: [
						{
							type: "change",
							deletions: 1,
							additions: 1,
							deletionLineIndex: 1,
							additionLineIndex: 1,
							noEOFCRDeletions: false,
							noEOFCRAdditions: false,
						},
					],
					hunkContext: undefined,
					hunkSpecs: undefined,
				},
			],
			splitLineCount: 0,
			unifiedLineCount: 0,
			deletionLines: ["line-01\n", "line-02\n", "line-03"],
			additionLines: ["line-01\n", "line-02-modified\n", "line-03"],
		};

		Reflect.set(state, "currentDiffData", {
			oldFile: {
				name: "example.ts",
				contents: "line-01\nline-02\nline-03",
				cacheKey: "legacy-old",
			},
			newFile: {
				name: "example.ts",
				contents: "line-01\nline-02-modified\nline-03",
				cacheKey: "legacy-new",
			},
			fileDiffMetadata: legacyMetadata,
		});

		const extracted = Reflect.apply(
			Reflect.get(state, "extractHunkOldContent") as (hunkIndex: number) => string,
			state,
			[0]
		);

		expect(extracted).toBe("line-02\n");
	});
});
