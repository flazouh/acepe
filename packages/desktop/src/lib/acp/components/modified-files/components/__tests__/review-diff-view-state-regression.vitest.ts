import { type FileContents, type FileDiffMetadata, parseDiffFromFile } from "@pierre/diffs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RenderArgs = {
	fileDiff: FileDiffMetadata;
};

const pierreMockState = vi.hoisted(() => {
	type CapturedFileDiffOptions = {
		readonly diffStyle?: "split" | "unified";
		readonly diffIndicators?: "classic" | "bars" | "none";
		readonly lineDiffType?: "word-alt" | "word" | "char" | "none";
		readonly disableBackground?: boolean;
		readonly overflow?: "scroll" | "wrap";
		readonly disableLineNumbers?: boolean;
		readonly expandUnchanged?: boolean;
		readonly expansionLineCount?: number;
	};

	class MockFileDiff {
		options: object;

		constructor(options: object) {
			this.options = options;
			pierreMockState.lastConstructedOptions = options as CapturedFileDiffOptions;
		}

		render(args: RenderArgs): void {
			pierreMockState.lastRenderArgs = args;
		}

		cleanUp(): void {}

		setOptions(options: object): void {
			this.options = options;
			pierreMockState.lastSetOptions = options as CapturedFileDiffOptions;
		}

		setThemeType(_themeType: "dark" | "light"): void {}

		rerender(): void {
			pierreMockState.rerenderCount += 1;
		}
	}

	return {
		lastRenderArgs: null as RenderArgs | null,
		lastBuildDiffStyle: null as "split" | "unified" | null,
		lastBuildOverflow: null as "scroll" | "wrap" | null,
		lastBuildDisableLineNumbers: null as boolean | null,
		lastConstructedOptions: null as CapturedFileDiffOptions | null,
		lastSetOptions: null as CapturedFileDiffOptions | null,
		rerenderCount: 0,
		MockFileDiff,
	};
});

vi.mock("@pierre/diffs", async () => {
	const actual = await vi.importActual<typeof import("@pierre/diffs")>("@pierre/diffs");
	return Object.assign({}, actual, {
		FileDiff: pierreMockState.MockFileDiff,
	});
});

vi.mock("$lib/acp/utils/worker-pool-singleton.js", () => ({
	getWorkerPool: (): undefined => undefined,
}));

vi.mock("$lib/acp/utils/pierre-rendering.js", () => ({
	buildPierreDiffOptions: (
		_themeType: "dark" | "light",
		diffStyle: "split" | "unified",
		overflow: "scroll" | "wrap",
		disableLineNumbers: boolean,
		_extraUnsafeCSS?: string
	): object => {
		pierreMockState.lastBuildDiffStyle = diffStyle;
		pierreMockState.lastBuildOverflow = overflow;
		pierreMockState.lastBuildDisableLineNumbers = disableLineNumbers;
		return { diffStyle, overflow, disableLineNumbers };
	},
	ensurePierreThemeRegistered: (): Promise<void> => Promise.resolve(),
}));

type ReviewDiffData = {
	readonly oldFile: FileContents;
	readonly newFile: FileContents;
	readonly fileDiffMetadata: FileDiffMetadata;
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

describe("ReviewDiffViewState regression", () => {
	beforeEach(() => {
		pierreMockState.lastRenderArgs = null;
		pierreMockState.lastBuildDiffStyle = null;
		pierreMockState.lastBuildOverflow = null;
		pierreMockState.lastBuildDisableLineNumbers = null;
		pierreMockState.lastConstructedOptions = null;
		pierreMockState.lastSetOptions = null;
		pierreMockState.rerenderCount = 0;
	});

	it("rebuilds render metadata when incoming line arrays are missing", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();
		const diffData = createSingleHunkDiffData();
		const corruptedMetadata = Object.assign({}, diffData.fileDiffMetadata);
		Reflect.deleteProperty(corruptedMetadata, "additionLines");
		Reflect.deleteProperty(corruptedMetadata, "deletionLines");

		const corruptedDiffData: ReviewDiffData = {
			oldFile: diffData.oldFile,
			newFile: diffData.newFile,
			fileDiffMetadata: corruptedMetadata,
		};

		await expect(
			state.initializeDiff(corruptedDiffData, document.createElement("div"))
		).resolves.toBeUndefined();

		const currentData = Reflect.get(state, "currentDiffData") as ReviewDiffData;
		expect(currentData.fileDiffMetadata.additionLines).toBeDefined();
		expect(currentData.fileDiffMetadata.deletionLines).toBeDefined();
		expect(pierreMockState.lastRenderArgs?.fileDiff.additionLines).toBeDefined();
		expect(pierreMockState.lastRenderArgs?.fileDiff.deletionLines).toBeDefined();
	});

	it("renders the change lines (green/red) without collapsing to context", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();
		const diffData = createSingleHunkDiffData();

		await state.initializeDiff(diffData, document.createElement("div"));

		const stats = state.getHunkStats();
		expect(stats.total).toBe(1);
		expect(stats.accepted).toBe(1);
		expect(stats.pending).toBe(0);
		// A persisted Keep is reflected in the stats (resolved, no pending
		// annotation) WITHOUT collapsing the rendered diff — the user still sees
		// the change when revisiting a kept file.
		expect(pierreMockState.lastRenderArgs?.fileDiff.hunks[0].hunkContent).toEqual(
			diffData.fileDiffMetadata.hunks[0].hunkContent
		);
		expect(
			pierreMockState.lastRenderArgs?.fileDiff.hunks.some((hunk) =>
				hunk.hunkContent.some((content) => content.type === "change")
			)
		).toBe(true);
	});

	it("uses the requested diff style when initializing the renderer", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();
		const diffData = createSingleHunkDiffData();

		await state.initializeDiff(diffData, document.createElement("div"), "default", "split");

		expect(state.diffStyle).toBe("split");
		expect(pierreMockState.lastBuildDiffStyle).toBe("split");
	});

	it("configures hunk expansion to reveal the entire hidden file region", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();
		const diffData = createSingleHunkDiffData();

		await state.initializeDiff(diffData, document.createElement("div"));

		expect(pierreMockState.lastConstructedOptions?.expandUnchanged).toBe(true);
		expect(pierreMockState.lastConstructedOptions?.expansionLineCount).toBe(
			Number.MAX_SAFE_INTEGER
		);
	});

	it("maps review diff styling controls to Pierre options", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();
		const diffData = createSingleHunkDiffData();

		await state.initializeDiff(diffData, document.createElement("div"), "default", "split", {
			indicatorStyle: "classic",
			lineChangeStyle: "character",
			showBackgrounds: false,
			wrapLines: false,
			showLineNumbers: false,
		});

		expect(pierreMockState.lastBuildOverflow).toBe("scroll");
		expect(pierreMockState.lastBuildDisableLineNumbers).toBe(true);
		expect(pierreMockState.lastConstructedOptions).toMatchObject({
			diffStyle: "split",
			diffIndicators: "classic",
			lineDiffType: "char",
			disableBackground: true,
			overflow: "scroll",
			disableLineNumbers: true,
		});
	});

	it("rerenders when review diff styling options change after initialization", async () => {
		const { ReviewDiffViewState } = await import("../review-diff-view-state.svelte.js");
		const state = new ReviewDiffViewState();
		const diffData = createSingleHunkDiffData();

		await state.initializeDiff(diffData, document.createElement("div"));
		state.setDiffOptions({
			indicatorStyle: "none",
			lineChangeStyle: "none",
			showBackgrounds: false,
			wrapLines: false,
			showLineNumbers: false,
		});

		expect(pierreMockState.rerenderCount).toBe(1);
		expect(pierreMockState.lastSetOptions).toMatchObject({
			diffIndicators: "none",
			lineDiffType: "none",
			disableBackground: true,
			overflow: "scroll",
			disableLineNumbers: true,
		});
	});
});
