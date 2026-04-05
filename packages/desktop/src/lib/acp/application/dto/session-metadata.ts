export type SessionLifecycleState = "created" | "persisted";

/**
 * Session metadata - rarely changing, serializable data.
 *
 * These fields are persisted to the database and change infrequently.
 * Separate from identity (which never changes) and hot state (which changes often).
 */
export interface SessionMetadata {
	readonly title: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	/**
	 * Source file path for direct O(1) retrieval (Cursor sessions).
	 * Set when session is discovered from filesystem scanning.
	 */
	readonly sourcePath?: string;
	/**
	 * Lifecycle state for the canonical session.
	 * A session exists once created; transcript persistence is just a later state.
	 */
	readonly sessionLifecycleState?: SessionLifecycleState;
	/**
	 * Parent session ID (for subsessions).
	 * null if this is a root session.
	 */
	readonly parentId: string | null;
	/**
	 * Associated pull request number when session references a PR.
	 * Used for sidebar PR badge and opening Git panel to PR view.
	 */
	readonly prNumber?: number;
	/**
	 * Current PR state (OPEN, CLOSED, MERGED).
	 * Ephemeral — defaults to "OPEN" when prNumber is set, updated from live GitHub data.
	 */
	readonly prState?: "OPEN" | "CLOSED" | "MERGED";
	/**
	 * True when the session still points at a worktree path, but that worktree was deleted.
	 * Ephemeral — used so the UI can keep the tree icon and show it in red.
	 */
	readonly worktreeDeleted?: boolean;
	/**
	 * Per-project sequence ID for Acepe-native sessions.
	 * Null/undefined for scanned/discovered sessions.
	 */
	readonly sequenceId?: number;
}
