/**
 * Git panel for source control operations.
 */
import type { GitWorkspacePanel } from "./types.js";

export interface GitPanelInitialTarget {
	section: "commits" | "prs";
	commitSha?: string;
	prNumber?: number;
}

export type GitPanel = GitWorkspacePanel;

export const DEFAULT_GIT_PANEL_WIDTH = 400;
export const MIN_GIT_PANEL_WIDTH = 320;
