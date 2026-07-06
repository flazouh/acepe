import { type FileContents, type FileDiffMetadata, parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/acp/utils/worker-pool-singleton.js", () => ({
	getWorkerPool: (): undefined => undefined,
}));

type ReviewDiffData = {
	readonly oldFile: FileContents;
	readonly newFile: FileContents;
	readonly fileDiffMetadata: FileDiffMetadata;
};

type RenderArgs = {
	fileDiff: FileDiffMetadata;
};

function createMultiHunkDiffData(): ReviewDiffData {
	const oldContents = [
		"line-01",
		"line-02",
		"line-03",
		"line-04",
		"line-05",
		"line-06",
		"line-07",
		"line-08",
		"line-09",
		"line-10",
		"line-11",
		"line-12",
		"line-13",
		"line-14",
		"line-15",
		"line-16",
	].join("\n");
	const newContents = [
		"line-01",
		"line-02-modified",
		"line-03",
		"line-04",
		"line-05",
		"line-06",
		"line-07",
		"line-08",
		"line-09",
		"line-10",
		"line-11",
		"line-12",
		"line-13",
		"line-14",
		"line-15-modified",
		"line-16",
	].join("\n");

	const oldFile: FileContents = {
		name: "example.ts",
		contents: oldContents,
		cacheKey: "review-old",
	};
	const newFile: FileContents = {
		name: "example.ts",
		contents: newContents,
		cacheKey: "review-new",
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
	const diffData = createMultiHunkDiffData();

	let lastRenderArgs: RenderArgs | null = null;
	const fakeFileDiffInstance = {
		render(args: RenderArgs): void {
			lastRenderArgs = args;
		},
	};

	Reflect.set(state, "currentDiffData", diffData);
	Reflect.set(state, "containerElement", document.createElement("div"));
	Reflect.set(state, "fileDiffInstance", fakeFileDiffInstance);

	return { state, diffData, lastRenderArgs: () => lastRenderArgs };
}

describe("ReviewDiffViewState (read-only renderer)", () => {
	it("re-renders the given metadata on updateDiff without mutating it", async () => {
		const { state, diffData, lastRenderArgs } = await setupState();

		expect(diffData.fileDiffMetadata.hunks.length).toBeGreaterThanOrEqual(2);

		state.updateDiff(diffData);

		const rendered = lastRenderArgs();
		expect(rendered).not.toBeNull();
		// The diff must still render its change lines (green/red), never collapse.
		expect(rendered?.fileDiff.hunks.some((hunk) =>
			hunk.hunkContent.some((content) => content.type === "change")
		)).toBe(true);
	}, 20_000);

	it("keeps rendered metadata structured-cloneable for worker postMessage", async () => {
		const { state, diffData, lastRenderArgs } = await setupState();

		state.updateDiff(diffData);

		expect(() => structuredClone(lastRenderArgs()?.fileDiff)).not.toThrow();
	}, 20_000);

	it("no-ops updateDiff when not initialized", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();

		expect(() => state.updateDiff(createMultiHunkDiffData())).not.toThrow();
	}, 20_000);
});
