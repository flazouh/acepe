/**
 * Browser panel for displaying web content via native Tauri webview.
 * Scoped to a project so it appears in that project's card.
 */
export interface BrowserPanel {
	/** Unique panel identifier */
	id: string;

	/** Absolute path to the project root this panel belongs to */
	projectPath: string;

	/** URL to display */
	url: string;

	/** Page title for display */
	title: string;

	/** Panel width in pixels */
	width: number;
}

export const DEFAULT_BROWSER_PANEL_WIDTH = 500;
export const MIN_BROWSER_PANEL_WIDTH = 320;
