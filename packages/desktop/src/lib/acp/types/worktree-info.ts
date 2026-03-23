/**
 * Information about a git worktree.
 */
export interface WorktreeInfo {
	/** The worktree name (e.g., "clever-falcon") */
	readonly name: string;
	/** The git branch name (e.g., "acepe/clever-falcon") */
	readonly branch: string;
	/** The full path to the worktree directory */
	readonly directory: string;
	/** Whether the worktree was created by acepe or externally */
	readonly origin: "acepe" | "external";
}
