import type { SessionSummary } from "../application/dto/session.js";
import type { SessionActivityInfo } from "../components/session-list/session-list-types.js";

import { ProjectManager } from "../logic/project-manager.svelte.js";

/**
 * Unified display item for sessions in the sidebar.
 *
 * This type allows the UI to render sessions uniformly.
 * Can be created from SessionSummary or historical data.
 *
 * Session Identity Model:
 * The `id` field IS the session ID (canonical identifier).
 */
export type SessionDisplayItem = {
	/**
	 * Canonical session identifier.
	 */
	id: string;

	/**
	 * Title of the session.
	 */
	title: string;

	/**
	 * ID of the agent that created this session.
	 */
	agentId: string;

	/**
	 * Path to the project folder this session is associated with.
	 */
	projectPath: string;

	/**
	 * Display name of the project (derived from path).
	 */
	projectName: string;

	/**
	 * Timestamp when the session was created.
	 */
	createdAt: Date;

	/**
	 * Timestamp when the session was last updated.
	 */
	updatedAt?: Date;

	/**
	 * Number of entries in the session.
	 */
	entryCount?: number;

	/**
	 * Whether the session is currently connected to an agent.
	 */
	isConnected?: boolean;

	/**
	 * Whether the session is currently streaming.
	 */
	isStreaming?: boolean;

	/**
	 * Optional project color (hex value) for displaying a colored dot.
	 */
	projectColor?: string;

	/**
	 * Activity information for streaming sessions.
	 */
	activity?: SessionActivityInfo | null;
	/**
	 * Total lines added across session edits.
	 */
	insertions?: number;
	/**
	 * Total lines removed across session edits.
	 */
	deletions?: number;
	/**
	 * Worktree path if this session runs in a worktree.
	 */
	worktreePath?: string;
	/**
	 * Associated PR number when session has an associated pull request.
	 */
	prNumber?: number;
	/**
	 * Current PR state (OPEN, CLOSED, MERGED).
	 */
	prState?: "OPEN" | "CLOSED" | "MERGED";
	/**
	 * True when the session still has a worktree path, but that worktree was deleted.
	 */
	worktreeDeleted?: boolean;
};

/**
 * Convert SessionSummary to SessionDisplayItem.
 */
export function sessionSummaryToDisplayItem(session: SessionSummary): SessionDisplayItem {
	return {
		id: session.id,
		title: session.title ?? "Untitled",
		agentId: session.agentId,
		projectPath: session.projectPath,
		projectName: ProjectManager.getProjectNameFromPath(session.projectPath),
		createdAt: session.updatedAt, // Use updatedAt as the sort date
		updatedAt: session.updatedAt,
		entryCount: session.entryCount,
		isConnected: session.isConnected,
		isStreaming: session.isStreaming,
		worktreePath: session.worktreePath,
		prNumber: session.prNumber,
		prState: session.prState,
		worktreeDeleted: session.worktreeDeleted,
	};
}
