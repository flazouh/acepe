import {
	type DiffLineAnnotation,
	diffAcceptRejectHunk,
	type FileContents,
	FileDiff,
	type FileDiffMetadata,
} from "@pierre/diffs";
import { ResultAsync } from "neverthrow";
import { mount, unmount } from "svelte";

import {
	buildPierreDiffOptions,
	ensurePierreThemeRegistered,
} from "../../../utils/pierre-rendering.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import { computeRevertedFileContent } from "../logic/compute-reverted-file-content.js";
import DiffHunkActionButtons from "./diff-hunk-action-buttons.svelte";

/**
 * Diff view style options.
 */
export type DiffViewStyle = "split" | "unified";

/**
 * Callback for accept/reject hunk actions.
 * @param hunkIndex - The index of the hunk being acted upon
 * @param action - The action to perform
 * @param hunkOldContent - The old content of the hunk (deletions) for revert operations
 */
export type HunkActionCallback = (
	hunkIndex: number,
	action: "accept" | "reject",
	hunkOldContent: string
) => void;

/**
 * Metadata for line annotations used in accept/reject UI.
 */
type AnnotationMetadata = {
	hunkIndex: number;
};

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

function getLinesForRange(lines: string[], startIndex: number, count: number): string[] {
	return lines.slice(startIndex, startIndex + count);
}

function getContentLineCount(lines: string[] | number): number {
	return Array.isArray(lines) ? lines.length : lines;
}

function getLegacyDeletionLines(fileDiffMetadata: CompatibleFileDiffMetadata): string[] {
	return fileDiffMetadata.deletionLines ?? [];
}

function getChangeDeletionLines(
	fileDiffMetadata: CompatibleFileDiffMetadata,
	content: CompatibleHunkContent
): string[] {
	if (content.type !== "change") {
		return [];
	}

	return getLinesForRange(
		getLegacyDeletionLines(fileDiffMetadata),
		content.deletionLineIndex,
		content.deletions
	);
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
 * State manager for the review drawer diff view.
 *
 * Extends the edit tool diff view with:
 * - Full file rendering with expandable hunks (hunkSeparators: 'line-info')
 * - Uses FileDiffMetadata for optimized rendering
 */
export class ReviewDiffViewState {
	/**
	 * The FileDiff instance for rendering diffs.
	 */
	private fileDiffInstance: FileDiff<AnnotationMetadata> | null = $state(null);

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
	 * Reference to the mounted header controls component for cleanup.
	 */
	private headerControlsComponent: ReturnType<typeof mount> | null = $state(null);

	/**
	 * References to mounted annotation button components for cleanup.
	 */
	private annotationComponents: ReturnType<typeof mount>[] = $state([]);

	/**
	 * The current theme type (dark or light).
	 */
	themeType: "dark" | "light" = $state("dark");

	/**
	 * Flag indicating whether this instance has been disposed.
	 */
	private isDisposed = $state(false);

	/**
	 * Promise that tracks theme registration to prevent race conditions.
	 */
	/**
	 * Callback for hunk accept/reject actions.
	 */
	private onHunkAction: HunkActionCallback | null = null;

	/**
	 * Line annotations for accept/reject UI on each change hunk.
	 */
	private lineAnnotations: DiffLineAnnotation<AnnotationMetadata>[] = $state([]);

	/**
	 * Initial total hunk count (captured at first diff load).
	 */
	private totalHunksAtInit = 0;

	/**
	 * Count of hunks accepted (tracked for getHunkStats).
	 */
	private acceptedCount = 0;

	/**
	 * Count of hunks rejected (tracked for getHunkStats).
	 */
	private rejectedCount = 0;

	/**
	 * Index of the currently focused/active hunk for navigation.
	 */
	private activeHunkIndex: number | null = null;

	/**
	 * Initializes and renders the diff using @pierre/diffs.
	 *
	 * @param diffData - The diff data with pre-parsed FileDiffMetadata
	 * @param container - The container element to render into
	 * @param onStyleChange - Optional callback when diff style changes via header toggle
	 */
	async initializeDiff(
		diffData: ReviewDiffData,
		container: HTMLElement,
		_onStyleChange?: (style: DiffViewStyle) => void,
		onHunkAction?: HunkActionCallback
	): Promise<void> {
		this.onHunkAction = onHunkAction ?? null;
		// Ensure theme is registered and AWAIT completion before rendering
		const themeResult = await ResultAsync.fromPromise(
			ensurePierreThemeRegistered(),
			(e) => e as Error
		);

		if (themeResult.isErr()) {
			console.error(
				"Theme registration failed, proceeding without custom theme:",
				themeResult.error
			);
		}

		// Clean up existing instances
		this.cleanupAnnotationComponents();
		if (this.fileDiffInstance) {
			this.fileDiffInstance.cleanUp();
			this.fileDiffInstance = null;
		}

		// Clean up any existing mounted header controls component
		if (this.headerControlsComponent) {
			unmount(this.headerControlsComponent);
			this.headerControlsComponent = null;
		}

		this.containerElement = container;
		this.currentDiffData = diffData;
		this.totalHunksAtInit = diffData.fileDiffMetadata.hunks.length;
		this.acceptedCount = 0;
		this.rejectedCount = 0;
		this.activeHunkIndex = null;

		// Build line annotations for accept/reject UI on each change hunk
		this.lineAnnotations = this.onHunkAction
			? this.buildLineAnnotationsFromHunks(diffData.fileDiffMetadata)
			: [];

		// Create FileDiff instance with full file rendering options
		this.fileDiffInstance = new FileDiff<AnnotationMetadata>(
			Object.assign(
				buildPierreDiffOptions<AnnotationMetadata>(this.themeType, this.diffStyle, "wrap", false),
				{
					// Use native line-info separator (no custom buttons)
					// Don't expand all unchanged by default - let user click to expand
					// Lines revealed per click when expanding collapsed regions
					expansionLineCount: 100,
					enableLineSelection: false,
					enableHoverUtility: false,
					// Render accept/reject buttons via annotations
					renderAnnotation: this.onHunkAction
						? (annotation: DiffLineAnnotation<AnnotationMetadata>) =>
								this.createAnnotationElement(annotation)
						: undefined,
				}
			),
			getWorkerPool()
		);

		// Render using pre-parsed FileDiffMetadata for optimized rendering
		if (this.fileDiffInstance) {
			this.fileDiffInstance.render({
				fileDiff: diffData.fileDiffMetadata,
				containerWrapper: container,
				lineAnnotations: this.lineAnnotations,
			});
		}
	}

	/**
	 * Updates the diff with new data.
	 */
	updateDiff(diffData: ReviewDiffData): void {
		if (!this.fileDiffInstance || !this.containerElement) {
			return;
		}

		this.currentDiffData = diffData;
		// Don't pass containerWrapper on updates - it causes DataCloneError
		// when using WorkerPoolManager. The container is already set.
		this.fileDiffInstance.render({
			fileDiff: diffData.fileDiffMetadata,
		});
	}

	/**
	 * Changes the diff view style and re-renders.
	 */
	setDiffStyle(style: DiffViewStyle): void {
		if (!this.fileDiffInstance || !this.containerElement || !this.currentDiffData) {
			return;
		}

		this.diffStyle = style;

		this.fileDiffInstance.setOptions(
			Object.assign({}, this.fileDiffInstance.options, {
				diffStyle: style,
			})
		);
		this.fileDiffInstance.rerender();
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
	 * Builds line annotations for each change hunk to show accept/reject buttons.
	 * Prefers placing the annotation on the last addition line; falls back to the
	 * last deletion line for deletion-only hunks.
	 */
	private buildLineAnnotationsFromHunks(
		fileDiff: FileDiffMetadata
	): DiffLineAnnotation<AnnotationMetadata>[] {
		const compatibleMetadata = fileDiff as CompatibleFileDiffMetadata;
		const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [];

		for (let hunkIndex = 0; hunkIndex < compatibleMetadata.hunks.length; hunkIndex++) {
			const hunk = compatibleMetadata.hunks[hunkIndex];

			// Skip resolved hunks (context-only after diffAcceptRejectHunk)
			const hasChanges = hunk.hunkContent.some((c) => c.type === "change");
			if (!hasChanges) continue;

			let additionLineOffset = 0;
			let deletionLineOffset = 0;
			let annotationPlaced = false;

			for (const content of hunk.hunkContent as CompatibleHunkContent[]) {
				if (content.type === "context") {
					const lineCount = getContentLineCount(content.lines);
					additionLineOffset += lineCount;
					deletionLineOffset += lineCount;
				} else if (content.type === "change") {
					const additionsCount = getContentLineCount(content.additions);
					if (additionsCount > 0) {
						const lastAdditionLineNumber =
							hunk.additionStart + additionLineOffset + additionsCount - 1;
						annotations.push({
							side: "additions",
							lineNumber: lastAdditionLineNumber,
							metadata: { hunkIndex },
						});
						annotationPlaced = true;
						break;
					}
					deletionLineOffset += getContentLineCount(content.deletions);
				}
			}

			// Deletion-only hunk: place annotation on the last deletion line
			if (!annotationPlaced && deletionLineOffset > 0) {
				const lastDeletionLineNumber = hunk.deletionStart + deletionLineOffset - 1;
				annotations.push({
					side: "deletions",
					lineNumber: lastDeletionLineNumber,
					metadata: { hunkIndex },
				});
			}
		}

		return annotations;
	}

	/**
	 * Creates the annotation element with Undo/Keep buttons.
	 * Uses the DiffHunkActionButtons Svelte component for consistent styling.
	 */
	private createAnnotationElement(
		annotation: DiffLineAnnotation<AnnotationMetadata>
	): HTMLElement | undefined {
		if (this.isDisposed) return undefined;

		const container = document.createElement("div");
		container.setAttribute("data-hunk-index", String(annotation.metadata.hunkIndex));
		container.style.cssText = "display: flex; justify-content: flex-end;";

		const componentInstance = mount(DiffHunkActionButtons, {
			target: container,
			props: {
				onUndo: () => {
					if (!this.isDisposed && this.onHunkAction && this.currentDiffData) {
						const revertedContent = computeRevertedFileContent(
							this.currentDiffData.newFile.contents,
							this.currentDiffData.fileDiffMetadata,
							annotation.metadata.hunkIndex
						);
						this.onHunkAction(annotation.metadata.hunkIndex, "reject", revertedContent);
					}
				},
				onKeep: () => {
					if (!this.isDisposed && this.onHunkAction && this.currentDiffData) {
						const hunkOldContent = this.extractHunkOldContent(annotation.metadata.hunkIndex);
						this.onHunkAction(annotation.metadata.hunkIndex, "accept", hunkOldContent);
					}
				},
			},
		});

		// Track the component for cleanup
		this.annotationComponents.push(componentInstance);

		return container;
	}

	/**
	 * Extracts the old content (deletions) from a specific hunk.
	 * This is used when rejecting a hunk to revert only that hunk's changes.
	 */
	private extractHunkOldContent(hunkIndex: number): string {
		if (!this.currentDiffData) return "";

		const hunk = this.currentDiffData.fileDiffMetadata.hunks[hunkIndex];
		if (!hunk) return "";

		const deletions: string[] = [];
		const compatibleMetadata = this.currentDiffData.fileDiffMetadata as CompatibleFileDiffMetadata;
		for (const content of hunk.hunkContent as CompatibleHunkContent[]) {
			if (content.type === "change") {
				deletions.push(...getChangeDeletionLines(compatibleMetadata, content));
			}
		}

		return deletions.join("\n");
	}

	/**
	 * Gets the index of the first pending hunk that has an annotation (accept/reject buttons).
	 * Returns null if no pending hunks exist.
	 */
	getFirstPendingHunkIndex(): number | null {
		if (this.lineAnnotations.length === 0) {
			return null;
		}
		// Return the first annotation's hunk index
		return this.lineAnnotations[0].metadata.hunkIndex;
	}

	/**
	 * Checks if all hunks have been accepted or rejected.
	 * Returns true when there are no remaining pending hunks.
	 */
	hasNoPendingHunks(): boolean {
		return this.lineAnnotations.length === 0;
	}

	/**
	 * Accepts the first pending hunk via keyboard shortcut.
	 * Returns the old content of the hunk for potential undo operations.
	 */
	acceptFirstPendingHunk(): { hunkIndex: number; oldContent: string } | null {
		const hunkIndex = this.getFirstPendingHunkIndex();
		if (hunkIndex === null || !this.onHunkAction) {
			return null;
		}

		const oldContent = this.extractHunkOldContent(hunkIndex);
		this.onHunkAction(hunkIndex, "accept", oldContent);
		return { hunkIndex, oldContent };
	}

	/**
	 * Rejects the first pending hunk via keyboard shortcut.
	 * Returns the reverted content of the file for the revert operation.
	 */
	rejectFirstPendingHunk(): { hunkIndex: number; oldContent: string } | null {
		const hunkIndex = this.getFirstPendingHunkIndex();
		if (hunkIndex === null || !this.onHunkAction || !this.currentDiffData) {
			return null;
		}

		const revertedContent = computeRevertedFileContent(
			this.currentDiffData.newFile.contents,
			this.currentDiffData.fileDiffMetadata,
			hunkIndex
		);
		this.onHunkAction(hunkIndex, "reject", revertedContent);
		return { hunkIndex, oldContent: revertedContent };
	}

	/**
	 * Accepts the currently active/focused hunk.
	 * Falls back to the first pending hunk if no hunk is focused.
	 */
	acceptActiveHunk(): { hunkIndex: number; oldContent: string } | null {
		const hunkIndex = this.getActiveHunkIndex();
		if (hunkIndex === null || !this.onHunkAction) {
			return null;
		}

		const oldContent = this.extractHunkOldContent(hunkIndex);
		this.onHunkAction(hunkIndex, "accept", oldContent);
		return { hunkIndex, oldContent };
	}

	/**
	 * Rejects the currently active/focused hunk.
	 * Falls back to the first pending hunk if no hunk is focused.
	 */
	rejectActiveHunk(): { hunkIndex: number; oldContent: string } | null {
		const hunkIndex = this.getActiveHunkIndex();
		if (hunkIndex === null || !this.onHunkAction || !this.currentDiffData) {
			return null;
		}

		const revertedContent = computeRevertedFileContent(
			this.currentDiffData.newFile.contents,
			this.currentDiffData.fileDiffMetadata,
			hunkIndex
		);
		this.onHunkAction(hunkIndex, "reject", revertedContent);
		return { hunkIndex, oldContent: revertedContent };
	}

	/**
	 * Applies an accept or reject action to a hunk and re-renders.
	 *
	 * @returns The updated FileDiffMetadata after the action
	 */
	applyHunkAction(hunkIndex: number, action: "accept" | "reject"): FileDiffMetadata | null {
		if (!this.currentDiffData || !this.fileDiffInstance || !this.containerElement) {
			return null;
		}

		const currentDiffData = this.currentDiffData;

		const updatedMetadata = diffAcceptRejectHunk(
			currentDiffData.fileDiffMetadata,
			hunkIndex,
			action
		);

		// Increment counters after the library call succeeds
		if (action === "accept") {
			this.acceptedCount++;
		} else {
			this.rejectedCount++;
		}

		const updatedNewContents =
			action === "reject"
				? computeRevertedFileContent(
						currentDiffData.newFile.contents,
						currentDiffData.fileDiffMetadata,
						hunkIndex
					)
				: currentDiffData.newFile.contents;

		this.currentDiffData = Object.assign({}, currentDiffData, {
			fileDiffMetadata: updatedMetadata,
			newFile: Object.assign({}, currentDiffData.newFile, {
				contents: updatedNewContents,
			}),
		});

		// Clean up existing annotation components before re-rendering
		this.cleanupAnnotationComponents();

		// Rebuild line annotations for the updated hunks
		this.lineAnnotations = this.onHunkAction
			? this.buildLineAnnotationsFromHunks(updatedMetadata)
			: [];

		// Re-render with updated metadata and annotations
		// Don't pass containerWrapper on updates - it causes DataCloneError
		// when using WorkerPoolManager. The container is already set.
		this.fileDiffInstance.render({
			fileDiff: updatedMetadata,
			lineAnnotations: this.lineAnnotations,
		});

		return updatedMetadata;
	}

	/**
	 * Returns indices of hunks that still have pending accept/reject.
	 */
	getPendingHunkIndices(): number[] {
		return this.lineAnnotations.map((a) => a.metadata.hunkIndex);
	}

	/**
	 * Returns the currently focused hunk index, or first pending, or null.
	 */
	getActiveHunkIndex(): number | null {
		if (this.activeHunkIndex !== null) {
			const pending = this.getPendingHunkIndices();
			if (pending.includes(this.activeHunkIndex)) return this.activeHunkIndex;
		}
		return this.getFirstPendingHunkIndex();
	}

	/**
	 * Scrolls the container to bring the given hunk into view.
	 */
	focusHunk(hunkIndex: number): void {
		if (!this.containerElement) return;

		const pending = this.getPendingHunkIndices();
		if (!pending.includes(hunkIndex)) return;

		this.activeHunkIndex = hunkIndex;
		const selector = `[data-hunk-index="${hunkIndex}"]`;
		const el = this.containerElement.querySelector(selector);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		} else {
			this.containerElement.scrollTo({ top: 0, behavior: "smooth" });
		}
	}

	/**
	 * Focuses the next pending hunk. Returns its index or null.
	 */
	focusNextPendingHunk(): number | null {
		const pending = this.getPendingHunkIndices();
		if (pending.length === 0) return null;

		const current = this.getActiveHunkIndex();
		const idx = current === null ? -1 : pending.indexOf(current);
		const nextIdx = idx < pending.length - 1 ? idx + 1 : 0;
		const next = pending[nextIdx];
		this.focusHunk(next);
		return next;
	}

	/**
	 * Focuses the previous pending hunk. Returns its index or null.
	 */
	focusPrevPendingHunk(): number | null {
		const pending = this.getPendingHunkIndices();
		if (pending.length === 0) return null;

		const current = this.getActiveHunkIndex();
		const idx = current === null ? pending.length : pending.indexOf(current);
		const prevIdx = idx > 0 ? idx - 1 : pending.length - 1;
		const prev = pending[prevIdx];
		this.focusHunk(prev);
		return prev;
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
	 * Returns hunk statistics for the current file.
	 */
	getHunkStats(): { total: number; pending: number; accepted: number; rejected: number } {
		const pending = this.lineAnnotations.length;
		return {
			total: this.totalHunksAtInit,
			pending,
			accepted: this.acceptedCount,
			rejected: this.rejectedCount,
		};
	}

	/**
	 * Unmounts all annotation components.
	 */
	private cleanupAnnotationComponents(): void {
		for (const component of this.annotationComponents) {
			unmount(component);
		}
		this.annotationComponents = [];
	}

	/**
	 * Cleans up the FileDiff instance and unmounts all mounted components.
	 */
	cleanup(): void {
		this.isDisposed = true;
		this.cleanupAnnotationComponents();
		if (this.headerControlsComponent) {
			unmount(this.headerControlsComponent);
			this.headerControlsComponent = null;
		}
		if (this.fileDiffInstance) {
			this.fileDiffInstance.cleanUp();
			this.fileDiffInstance = null;
		}
		this.containerElement = null;
		this.currentDiffData = null;
	}
}
