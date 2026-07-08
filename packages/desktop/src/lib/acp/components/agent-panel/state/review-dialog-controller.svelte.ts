/**
 * ReviewDialogController — owns the agent panel's in-panel review-dialog UI
 * state (open flag, files snapshot, selected file index, control snapshot) plus
 * the two pure derivations over it (clamped index, aggregate diff stats),
 * hoisted out of the `agent-panel.svelte` god controller so it is independently
 * unit-testable. Self-contained — independent of the canonicalPanelSessionState
 * / viewState hubs (see docs/plans/2026-05-29-002-...).
 *
 * The async open path (session review-state load) stays in the component since
 * it depends on a store + sessionId; it delegates state mutation here via open().
 */
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import {
	DEFAULT_REVIEW_DIFF_OPTIONS,
	type DiffViewStyle,
	type ReviewDiffIndicatorStyle,
	type ReviewDiffLineChangeStyle,
	type ReviewDiffOptions,
} from "../../modified-files/components/review-diff-view-state.svelte.js";
import type { ReviewControlsSnapshot } from "../components/agent-panel-review-content-types.js";

export interface ReviewDialogDiffStats {
	insertions: number;
	deletions: number;
}

export class ReviewDialogController {
	#open = $state(false);
	#filesState = $state<ModifiedFilesState | null>(null);
	#fileIndex = $state(0);
	#controls = $state<ReviewControlsSnapshot | null>(null);
	#diffStyle = $state<DiffViewStyle>("unified");
	#diffOptions = $state<ReviewDiffOptions>(DEFAULT_REVIEW_DIFF_OPTIONS);

	get isOpen(): boolean {
		return this.#open;
	}

	get filesState(): ModifiedFilesState | null {
		return this.#filesState;
	}

	get controls(): ReviewControlsSnapshot | null {
		return this.#controls;
	}

	get diffStyle(): DiffViewStyle {
		return this.#diffStyle;
	}

	get diffOptions(): ReviewDiffOptions {
		return this.#diffOptions;
	}

	/** Selected file index, clamped to the current file list. */
	readonly clampedFileIndex = $derived.by((): number => {
		const fileCount = this.#filesState?.fileCount ?? 0;
		if (fileCount === 0) {
			return 0;
		}
		return Math.min(Math.max(this.#fileIndex, 0), fileCount - 1);
	});

	/** Aggregate insertions/deletions across all files in the snapshot. */
	readonly diffStats = $derived.by((): ReviewDialogDiffStats => {
		if (!this.#filesState) {
			return { insertions: 0, deletions: 0 };
		}

		return this.#filesState.files.reduce(
			(totals, file) => ({
				insertions: totals.insertions + file.totalAdded,
				deletions: totals.deletions + file.totalRemoved,
			}),
			{ insertions: 0, deletions: 0 }
		);
	});

	setControls(controls: ReviewControlsSnapshot | null): void {
		this.#controls = controls;
	}

	setDiffStyle(diffStyle: DiffViewStyle): void {
		this.#diffStyle = diffStyle;
	}

	setDiffIndicatorStyle(indicatorStyle: ReviewDiffIndicatorStyle): void {
		this.#diffOptions = {
			indicatorStyle,
			lineChangeStyle: this.#diffOptions.lineChangeStyle,
			showBackgrounds: this.#diffOptions.showBackgrounds,
			wrapLines: this.#diffOptions.wrapLines,
			showLineNumbers: this.#diffOptions.showLineNumbers,
		};
	}

	setDiffLineChangeStyle(lineChangeStyle: ReviewDiffLineChangeStyle): void {
		this.#diffOptions = {
			indicatorStyle: this.#diffOptions.indicatorStyle,
			lineChangeStyle,
			showBackgrounds: this.#diffOptions.showBackgrounds,
			wrapLines: this.#diffOptions.wrapLines,
			showLineNumbers: this.#diffOptions.showLineNumbers,
		};
	}

	setDiffShowBackgrounds(showBackgrounds: boolean): void {
		this.#diffOptions = {
			indicatorStyle: this.#diffOptions.indicatorStyle,
			lineChangeStyle: this.#diffOptions.lineChangeStyle,
			showBackgrounds,
			wrapLines: this.#diffOptions.wrapLines,
			showLineNumbers: this.#diffOptions.showLineNumbers,
		};
	}

	setDiffWrapLines(wrapLines: boolean): void {
		this.#diffOptions = {
			indicatorStyle: this.#diffOptions.indicatorStyle,
			lineChangeStyle: this.#diffOptions.lineChangeStyle,
			showBackgrounds: this.#diffOptions.showBackgrounds,
			wrapLines,
			showLineNumbers: this.#diffOptions.showLineNumbers,
		};
	}

	setDiffShowLineNumbers(showLineNumbers: boolean): void {
		this.#diffOptions = {
			indicatorStyle: this.#diffOptions.indicatorStyle,
			lineChangeStyle: this.#diffOptions.lineChangeStyle,
			showBackgrounds: this.#diffOptions.showBackgrounds,
			wrapLines: this.#diffOptions.wrapLines,
			showLineNumbers,
		};
	}

	setFileIndex(index: number): void {
		this.#fileIndex = index;
	}

	/** Open the dialog at a resolved initial file index. */
	open(filesState: ModifiedFilesState, initialFileIndex: number): void {
		this.#filesState = filesState;
		this.#fileIndex = initialFileIndex;
		this.#open = true;
	}

	/** Mirror the original open-change handler: closing resets the snapshot. */
	setOpen(open: boolean): void {
		this.#open = open;
		if (open) {
			return;
		}
		this.#filesState = null;
		this.#fileIndex = 0;
	}
}
