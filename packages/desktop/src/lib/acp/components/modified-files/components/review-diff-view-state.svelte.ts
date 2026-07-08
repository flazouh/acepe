import {
	type FileContents,
	FileDiff,
	type FileDiffMetadata,
	type FileDiffOptions,
	type LineDiffTypes,
	parseDiffFromFile,
} from "@pierre/diffs";
import { ResultAsync } from "neverthrow";

import {
	buildPierreDiffOptions,
	ensurePierreThemeRegistered,
} from "../../../utils/pierre-rendering.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";

/**
 * Diff view style options.
 */
export type DiffViewStyle = "split" | "unified";
export type ReviewDiffDensity = "default" | "compact";
export type ReviewDiffIndicatorStyle = "bars" | "classic" | "none";
export type ReviewDiffLineChangeStyle = "none" | "word" | "character";
export type ReviewDiffOptions = {
	readonly indicatorStyle: ReviewDiffIndicatorStyle;
	readonly lineChangeStyle: ReviewDiffLineChangeStyle;
	readonly showBackgrounds: boolean;
	readonly wrapLines: boolean;
	readonly showLineNumbers: boolean;
};

export const DEFAULT_REVIEW_DIFF_OPTIONS: ReviewDiffOptions = {
	indicatorStyle: "bars",
	lineChangeStyle: "word",
	showBackgrounds: true,
	wrapLines: true,
	showLineNumbers: true,
};

const compactReviewDiffUnsafeCSS = `
[data-code] {
  font-size: 11px;
  line-height: 1.35;
  padding-bottom: 4px !important;
}
`;

const REVIEW_DIFF_EXPAND_ALL_LINE_COUNT = Number.MAX_SAFE_INTEGER;
type ReviewLineAnnotation = never;

function resolvePierreLineDiffType(lineChangeStyle: ReviewDiffLineChangeStyle): LineDiffTypes {
	if (lineChangeStyle === "none") return "none";
	if (lineChangeStyle === "character") return "char";
	return "word-alt";
}

function resolveReviewDiffOptionOverrides(
	diffStyle: DiffViewStyle,
	options: ReviewDiffOptions
): Partial<FileDiffOptions<ReviewLineAnnotation>> {
	return {
		diffStyle,
		diffIndicators: options.indicatorStyle,
		lineDiffType: resolvePierreLineDiffType(options.lineChangeStyle),
		disableBackground: !options.showBackgrounds,
		overflow: options.wrapLines ? "wrap" : "scroll",
		disableLineNumbers: !options.showLineNumbers,
	};
}

function resolveReviewDiffUnsafeCSS(density: ReviewDiffDensity): string {
	if (density === "compact") return compactReviewDiffUnsafeCSS;
	return "";
}

type LegacyContextContent = {
	type: "context";
	lines: number;
	noEOFCR: boolean;
	additionLineIndex?: number;
	deletionLineIndex?: number;
};

type LegacyChangeContent = {
	type: "change";
	deletions: number;
	additions: number;
	deletionLineIndex: number;
	additionLineIndex: number;
	noEOFCRDeletions: boolean;
	noEOFCRAdditions: boolean;
};

type CompatibleHunkContent =
	| FileDiffMetadata["hunks"][number]["hunkContent"][number]
	| LegacyContextContent
	| LegacyChangeContent;
type CompatibleFileDiffMetadata = FileDiffMetadata & {
	deletionLines?: string[];
	additionLines?: string[];
};
type CompatibleHunk = FileDiffMetadata["hunks"][number] & {
	deletionLineIndex?: number;
	additionLineIndex?: number;
};

function getContentLineCount(lines: string[] | number): number {
	return Array.isArray(lines) ? lines.length : lines;
}

function isLineRangeRenderable(
	lines: string[],
	startIndex: number | undefined,
	count: number
): boolean {
	if (count === 0) {
		return true;
	}

	if (startIndex === undefined) {
		return false;
	}

	return startIndex >= 0 && startIndex + count <= lines.length;
}

function hasRenderableLineContent(fileDiffMetadata: FileDiffMetadata): boolean {
	const compatibleMetadata = fileDiffMetadata as CompatibleFileDiffMetadata;
	const additionLines = compatibleMetadata.additionLines;
	const deletionLines = compatibleMetadata.deletionLines;

	if (!Array.isArray(additionLines) || !Array.isArray(deletionLines)) {
		return false;
	}

	for (const rawHunk of compatibleMetadata.hunks) {
		const hunk = rawHunk as CompatibleHunk;

		for (const content of hunk.hunkContent as CompatibleHunkContent[]) {
			if (content.type === "context") {
				const lineCount = getContentLineCount(content.lines);
				const additionStartIndex = content.additionLineIndex ?? hunk.additionLineIndex;
				const deletionStartIndex = content.deletionLineIndex ?? hunk.deletionLineIndex;

				if (!isLineRangeRenderable(additionLines, additionStartIndex, lineCount)) {
					return false;
				}

				if (!isLineRangeRenderable(deletionLines, deletionStartIndex, lineCount)) {
					return false;
				}
			} else {
				const additionCount = getContentLineCount(content.additions);
				const deletionCount = getContentLineCount(content.deletions);

				if (!isLineRangeRenderable(additionLines, content.additionLineIndex, additionCount)) {
					return false;
				}

				if (!isLineRangeRenderable(deletionLines, content.deletionLineIndex, deletionCount)) {
					return false;
				}
			}
		}
	}

	return true;
}

function hydrateLineContentFromFiles(diffData: ReviewDiffData): ReviewDiffData {
	const parsedMetadata = parseDiffFromFile(diffData.oldFile, diffData.newFile);
	const parsedCompatibleMetadata = parsedMetadata as CompatibleFileDiffMetadata;

	return {
		oldFile: diffData.oldFile,
		newFile: diffData.newFile,
		fileDiffMetadata: Object.assign({}, diffData.fileDiffMetadata, {
			deletionLines: parsedCompatibleMetadata.deletionLines ?? [],
			additionLines: parsedCompatibleMetadata.additionLines ?? [],
		}),
	};
}

function ensureRenderableDiffData(diffData: ReviewDiffData): ReviewDiffData {
	if (hasRenderableLineContent(diffData.fileDiffMetadata)) {
		return diffData;
	}

	const hydratedDiffData = hydrateLineContentFromFiles(diffData);
	if (hasRenderableLineContent(hydratedDiffData.fileDiffMetadata)) {
		return hydratedDiffData;
	}

	return {
		oldFile: diffData.oldFile,
		newFile: diffData.newFile,
		fileDiffMetadata: parseDiffFromFile(diffData.oldFile, diffData.newFile),
	};
}

/**
 * Data structure for diff rendering with pre-parsed metadata.
 */
export type ReviewDiffData = {
	readonly oldFile: FileContents;
	readonly newFile: FileContents;
	readonly fileDiffMetadata: FileDiffMetadata;
};

/**
 * State manager for the review modal diff view.
 *
 * A pure read-only renderer: renders the change (green/red lines) with full file
 * rendering and expandable hunks. No per-hunk accept/reject affordances.
 */
export class ReviewDiffViewState {
	/**
	 * The FileDiff instance for rendering diffs.
	 */
	private fileDiffInstance: FileDiff<ReviewLineAnnotation> | null = $state(null);

	/**
	 * The container element where the diff is rendered.
	 */
	private containerElement: HTMLElement | null = $state(null);

	/**
	 * The current diff data being displayed.
	 */
	private currentDiffData: ReviewDiffData | null = null;

	/**
	 * The current diff view style (split or unified).
	 */
	diffStyle: DiffViewStyle = $state("unified");

	/**
	 * The current diff styling options.
	 */
	diffOptions: ReviewDiffOptions = $state(DEFAULT_REVIEW_DIFF_OPTIONS);

	/**
	 * The current theme type (dark or light).
	 */
	themeType: "dark" | "light" = $state("dark");

	/**
	 * Monotonically increasing counter — incremented at the start of each
	 * initializeDiff call.  After the async theme-registration await we check
	 * that the stored counter still matches; if a newer call has already started
	 * we bail out to avoid racing against it.
	 */
	private initGeneration = 0;

	/**
	 * Initializes and renders the diff (read-only) using @pierre/diffs.
	 *
	 * @param diffData - The diff data with pre-parsed FileDiffMetadata
	 * @param container - The container element to render into
	 * @param density - Diff density (default or compact)
	 * @param diffStyle - Diff layout style (unified or split)
	 * @param diffOptions - Diff styling controls
	 */
	async initializeDiff(
		diffData: ReviewDiffData,
		container: HTMLElement,
		density: ReviewDiffDensity = "default",
		diffStyle: DiffViewStyle = this.diffStyle,
		diffOptions: ReviewDiffOptions = this.diffOptions
	): Promise<void> {
		// Claim this generation before the async pause so we can detect if a
		// newer call starts while we are awaiting theme registration.
		const generation = ++this.initGeneration;

		// Ensure theme is registered and AWAIT completion before rendering
		const themeResult = await ResultAsync.fromPromise(
			ensurePierreThemeRegistered(),
			(e) => e as Error
		);

		// A newer initializeDiff call started while we were awaiting — abandon
		// this invocation to avoid racing against the newer one.
		if (generation !== this.initGeneration) {
			return;
		}

		if (themeResult.isErr()) {
			console.error(
				"Theme registration failed, proceeding without custom theme:",
				themeResult.error
			);
		}

		// Clean up existing instance
		if (this.fileDiffInstance) {
			this.fileDiffInstance.cleanUp();
			this.fileDiffInstance = null;
		}

		const renderableDiffData = ensureRenderableDiffData(diffData);

		this.containerElement = container;
		this.currentDiffData = renderableDiffData;
		this.diffStyle = diffStyle;
		this.diffOptions = diffOptions;

		// Create FileDiff instance with full file rendering options
		this.fileDiffInstance = new FileDiff<ReviewLineAnnotation>(
			Object.assign(
				buildPierreDiffOptions(
					this.themeType,
					this.diffStyle,
					diffOptions.wrapLines ? "wrap" : "scroll",
					!diffOptions.showLineNumbers,
					resolveReviewDiffUnsafeCSS(density)
				),
				resolveReviewDiffOptionOverrides(this.diffStyle, diffOptions),
				{
					// Use native line-info separator (no custom buttons)
					// Review needs complete file context, including trailing unchanged lines.
					expandUnchanged: true,
					expansionLineCount: REVIEW_DIFF_EXPAND_ALL_LINE_COUNT,
					enableLineSelection: false,
					enableHoverUtility: false,
				}
			),
			getWorkerPool()
		);

		// Render using pre-parsed FileDiffMetadata for optimized rendering
		if (this.fileDiffInstance) {
			this.fileDiffInstance.render({
				fileDiff: renderableDiffData.fileDiffMetadata,
				containerWrapper: container,
			});
		}
	}

	private rerenderWithCurrentOptions(): void {
		if (!this.fileDiffInstance || !this.containerElement || !this.currentDiffData) {
			return;
		}

		this.fileDiffInstance.setOptions(
			Object.assign(
				{},
				this.fileDiffInstance.options,
				resolveReviewDiffOptionOverrides(this.diffStyle, this.diffOptions)
			)
		);
		this.fileDiffInstance.rerender();
	}

	/**
	 * Updates the diff with new data.
	 */
	updateDiff(diffData: ReviewDiffData): void {
		if (!this.fileDiffInstance || !this.containerElement) {
			return;
		}

		const renderableDiffData = ensureRenderableDiffData(diffData);

		this.currentDiffData = renderableDiffData;
		// Don't pass containerWrapper on updates - it causes DataCloneError
		// when using WorkerPoolManager. The container is already set.
		this.fileDiffInstance.render({
			fileDiff: renderableDiffData.fileDiffMetadata,
		});
	}

	/**
	 * Changes the diff view style and re-renders.
	 */
	setDiffStyle(style: DiffViewStyle): void {
		this.diffStyle = style;
		this.rerenderWithCurrentOptions();
	}

	/**
	 * Changes diff styling options and re-renders.
	 */
	setDiffOptions(options: ReviewDiffOptions): void {
		this.diffOptions = options;
		this.rerenderWithCurrentOptions();
	}

	/**
	 * Changes the theme type and updates the diff.
	 */
	setThemeType(newThemeType: "dark" | "light"): void {
		if (!this.fileDiffInstance || !this.containerElement || !this.currentDiffData) {
			return;
		}

		this.themeType = newThemeType;
		this.fileDiffInstance.setThemeType(newThemeType);
		this.fileDiffInstance.rerender();
	}

	/**
	 * Scrolls the diff container to the top.
	 */
	scrollToTop(): void {
		this.containerElement?.scrollTo({ top: 0, behavior: "smooth" });
	}

	/**
	 * Scrolls the diff container to the bottom.
	 */
	scrollToBottom(): void {
		if (!this.containerElement) return;
		this.containerElement.scrollTo({
			top: this.containerElement.scrollHeight,
			behavior: "smooth",
		});
	}

	/**
	 * Cleans up the FileDiff instance.
	 */
	cleanup(): void {
		if (this.fileDiffInstance) {
			this.fileDiffInstance.cleanUp();
			this.fileDiffInstance = null;
		}
		this.containerElement = null;
		this.currentDiffData = null;
	}
}
