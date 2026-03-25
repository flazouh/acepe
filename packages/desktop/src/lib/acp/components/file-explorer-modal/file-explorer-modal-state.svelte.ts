/**
 * File Explorer Modal State
 *
 * Manages the search query, result rows, keyboard navigation, preview, and
 * in-flight request sequencing for the Cmd+I file explorer modal.
 *
 * Designed to be instantiated fresh each time the modal opens so that
 * stale state from a previous session does not leak through.
 */

import type {
	FileExplorerPreviewResponse,
	FileExplorerRow,
	FileExplorerSearchResponse,
} from "$lib/services/converted-session-types.js";

/** How many results to request per search. */
const SEARCH_LIMIT = 50;

export interface FileExplorerModalStateOptions {
	/** Project paths to search within. */
	projectPaths: string[];
	/** Function that performs the actual search (injected for testability). */
	searchFn: (
		projectPaths: string[],
		query: string,
		limit: number,
		offset: number
	) => Promise<FileExplorerSearchResponse>;
	/** Function that loads the preview (injected for testability). */
	previewFn: (
		projectPath: string,
		filePath: string
	) => Promise<FileExplorerPreviewResponse>;
}

export class FileExplorerModalState {
	/** Current search query (bound to the input). */
	query = $state("");

	/** Latest ranked rows from the backend. */
	rows = $state<FileExplorerRow[]>([]);

	/** Index of the highlighted row in the results list. */
	selectedIndex = $state(0);

	/** Preview payload for the selected row, or null if not yet loaded. */
	preview = $state<FileExplorerPreviewResponse | null>(null);

	/** Whether a search request is in flight. */
	isLoading = $state(false);

	/** Monotonically-increasing counter used to discard stale responses. */
	private searchSeq = 0;

	/** Monotonically-increasing counter used to discard stale preview responses. */
	private previewSeq = 0;

	private readonly projectPaths: string[];
	private readonly searchFn: FileExplorerModalStateOptions["searchFn"];
	private readonly previewFn: FileExplorerModalStateOptions["previewFn"];

	constructor(opts: FileExplorerModalStateOptions) {
		this.projectPaths = opts.projectPaths;
		this.searchFn = opts.searchFn;
		this.previewFn = opts.previewFn;
	}

	// ---------------------------------------------------------------------------
	// Query
	// ---------------------------------------------------------------------------

	/**
	 * Sets the search query and resets navigation to the top.
	 * Callers are responsible for debouncing before calling `searchNow`.
	 */
	setQuery(query: string): void {
		this.query = query;
		this.selectedIndex = 0;
	}

	// ---------------------------------------------------------------------------
	// Reset
	// ---------------------------------------------------------------------------

	/** Resets all volatile state. Call when the modal closes. */
	reset(): void {
		this.query = "";
		this.rows = [];
		this.selectedIndex = 0;
		this.preview = null;
		this.isLoading = false;
		this.searchSeq = this.searchSeq + 1; // invalidate any in-flight request
		this.previewSeq = this.previewSeq + 1;
	}

	// ---------------------------------------------------------------------------
	// Search
	// ---------------------------------------------------------------------------

	/**
	 * Executes a search immediately using the current `query`.
	 * Handles in-flight sequencing so only the most-recent response is applied.
	 */
	async searchNow(): Promise<void> {
		const seq = this.searchSeq + 1;
		this.searchSeq = seq;
		this.previewSeq = this.previewSeq + 1;
		this.isLoading = true;
		this.preview = null;

		const response = await this.searchFn(this.projectPaths, this.query, SEARCH_LIMIT, 0);

		// Discard stale response if another search was started after this one
		if (seq !== this.searchSeq) {
			return;
		}

		this.rows = response.rows;
		this.selectedIndex = 0;
		this.preview = null;
		this.isLoading = false;

		const firstRow = this.selectedRow;
		if (firstRow !== null) {
			await this.loadPreview(firstRow.path);
		}
	}

	// ---------------------------------------------------------------------------
	// Preview
	// ---------------------------------------------------------------------------

	/** Loads the preview for a given file path. */
	async loadPreview(filePath: string): Promise<void> {
		const selectedRow = this.selectedRow;
		if (selectedRow === null || selectedRow.path !== filePath) {
			return;
		}
		const seq = this.previewSeq + 1;
		this.previewSeq = seq;
		const response = await this.previewFn(selectedRow.projectPath, filePath);
		if (seq !== this.previewSeq) {
			return;
		}
		const activeRow = this.selectedRow;
		if (activeRow === null || activeRow.path !== filePath || activeRow.projectPath !== selectedRow.projectPath) {
			return;
		}
		this.preview = response;
	}

	// ---------------------------------------------------------------------------
	// Keyboard navigation
	// ---------------------------------------------------------------------------

	/** Move selection one step down (wraps). No-op if rows is empty. */
	navigateDown(): void {
		if (this.rows.length === 0) return;
		this.selectedIndex = (this.selectedIndex + 1) % this.rows.length;
	}

	/** Move selection one step up (wraps). No-op if rows is empty. */
	navigateUp(): void {
		if (this.rows.length === 0) return;
		this.selectedIndex =
			this.selectedIndex <= 0 ? this.rows.length - 1 : this.selectedIndex - 1;
	}

	// ---------------------------------------------------------------------------
	// Derived helpers
	// ---------------------------------------------------------------------------

	/** The currently selected row, or null when the list is empty. */
	get selectedRow(): FileExplorerRow | null {
		if (this.rows.length === 0) return null;
		const row = this.rows[this.selectedIndex];
		return row ? row : null;
	}
}
