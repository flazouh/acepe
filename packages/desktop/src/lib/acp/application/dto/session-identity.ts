/**
 * Session identity - immutable lookup keys.
 *
 * These fields uniquely identify a session and never change after creation.
 * Used for O(1) lookups in maps and database queries.
 */
export interface SessionIdentity {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
	/**
	 * Optional worktree path when session operates in a git worktree.
	 * Used for path conversion when creating checkpoints.
	 */
	readonly worktreePath?: string;
}
