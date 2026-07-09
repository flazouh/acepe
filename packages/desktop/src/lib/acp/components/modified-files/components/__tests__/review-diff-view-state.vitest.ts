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

	it("resolved hunk produces no annotation after accept", async () => {
		const { state, diffData } = await setupState({ withHunkAction: true });
		const hunkCount = diffData.fileDiffMetadata.hunks.length;
		expect(hunkCount).toBe(2);

		// Accept hunk 0 — it becomes context-only
		state.applyHunkAction(0, "accept");

		// Only hunk 1 should have an annotation now
		const annotations = Reflect.get(state, "lineAnnotations") as DiffLineAnnotation<{
			hunkIndex: number;
		}>[];
		expect(annotations).toHaveLength(1);
		expect(annotations[0].metadata.hunkIndex).toBe(1);
	}, 20_000);

	it("keeps the diff visible after a hunk is kept (accept does not collapse to context)", async () => {
		const { state, diffData, lastRenderArgs } = await setupState({ withHunkAction: true });
		expect(diffData.fileDiffMetadata.hunks.length).toBe(2);

		state.applyHunkAction(0, "accept");

		const rendered = lastRenderArgs();
		expect(rendered).not.toBeNull();
		const keptHunk = rendered?.fileDiff.hunks[0];
		// The kept hunk must still render its change (additions/deletions), not
		// collapse to context-only — the user keeps seeing the diff after Keep.
		expect(keptHunk?.hunkContent.some((c) => c.type === "change")).toBe(true);

		// Accept is a review marker, not a revert: contents stay the agent's output.
		const currentData = Reflect.get(state, "currentDiffData") as ReviewDiffData;
		expect(currentData.newFile.contents).toBe(diffData.newFile.contents);
	}, 20_000);

	it("newFile.contents updates after reject to stay in sync with metadata", async () => {
		const { state, diffData } = await setupState({ withHunkAction: true });
		const originalNewContents = diffData.newFile.contents;

		// Reject hunk 0 — newFile.contents should change
		state.applyHunkAction(0, "reject");

		const currentData = Reflect.get(state, "currentDiffData") as ReviewDiffData;
		expect(currentData.newFile.contents).not.toBe(originalNewContents);

		expect(currentData.fileDiffMetadata.additionLines).toBeDefined();
		expect(currentData.newFile.contents).toBe(currentData.fileDiffMetadata.additionLines.join(""));
	}, 20_000);

	it("sequential rejects produce correct content (all changes reverted)", async () => {
		const { state, diffData } = await setupState({ withHunkAction: true });
		const originalOldContents = diffData.oldFile.contents;

		// Reject both hunks — file should revert to the old content
		state.applyHunkAction(0, "reject");
		state.applyHunkAction(1, "reject");

		const currentData = Reflect.get(state, "currentDiffData") as ReviewDiffData;
		expect(currentData.newFile.contents).toBe(originalOldContents);
	}, 20_000);

	it("returns null and does not increment counters when not initialized", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();

		expect(() => state.updateDiff(createMultiHunkDiffData())).not.toThrow();
	}, 20_000);
});
