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
});
