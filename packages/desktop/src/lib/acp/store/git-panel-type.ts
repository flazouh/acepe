/**
 * Git panel for source control operations.
 */
export interface GitPanelInitialTarget {
	section: "commits" | "prs";
	commitSha?: string;
	prNumber?: number;
}

export interface GitPanel {
	/** Unique panel identifier */
	id: string;

	/** Absolute path to the project root */
	projectPath: string;

	/** Panel width in pixels */
	width: number;

	/** Initial navigation target for source control sections */
	initialTarget?: GitPanelInitialTarget;
}

export const DEFAULT_GIT_PANEL_WIDTH = 400;
export const MIN_GIT_PANEL_WIDTH = 320;
