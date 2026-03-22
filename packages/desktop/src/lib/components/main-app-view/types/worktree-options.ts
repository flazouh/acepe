/**
 * Options for creating a session with worktree support.
 */
export interface WorktreeOptions {
	readonly worktreePath?: string;
	readonly worktreeBranch?: string;
	readonly worktreeName?: string;
}
