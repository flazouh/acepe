import type { WorktreeInfo } from "../../types/worktree-info.js";

/**
 * Props for the WorktreeToggle presentation component.
 */
export interface WorktreeToggleProps {
	readonly enabled: boolean;
	readonly disabled: boolean;
	readonly loading: boolean;
	readonly tooltipText: string;
	readonly onToggle: () => void;
}

/**
 * Configuration for WorktreeToggleState.
 */
export interface WorktreeToggleConfig {
	readonly panelId: string;
	readonly projectPath: string | null;
	readonly globalDefault: boolean;
}

/**
 * Callback for when worktree is created and session should be created.
 */
export type OnWorktreeCreatedCallback = (worktreeInfo: WorktreeInfo) => void;
