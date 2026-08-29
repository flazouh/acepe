/**
 * Browser panel for displaying web content in a native child webview.
 * Scoped to a project so it appears in that project's card.
 */
export interface BrowserPanel {
	/** Unique panel identifier */
	id: string;

	/** Panel kind for unified workspace panel state. */
	readonly kind: "browser";

	/** Absolute path to the project root this panel belongs to */
	projectPath: string;

	/** URL to display */
	url: string;

	/** Page title for display */
	title: string;

	/** Panel width in pixels */
	width: number;

	/** Owning workspace panel for attached use; null for top-level browser panels. */
	ownerPanelId: null;
}

export const DEFAULT_BROWSER_PANEL_WIDTH = 500;
export const MIN_BROWSER_PANEL_WIDTH = 320;
