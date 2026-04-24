import type {
	SessionLinkedPr,
	SessionPrLinkMode,
} from "../../application/dto/session-linked-pr.js";
import type { ToolKind } from "../../types/tool-kind.js";

/**
 * Todo progress for display in session list.
 */
export interface TodoProgressInfo {
	/** Current step number (1-indexed) */
	current: number;
	/** Total number of steps */
	total: number;
	/** Label for the current task (activeForm or content) */
	label: string;
}

/**
 * Last tool info for display in session list.
 */
export interface LastToolInfo {
	/** Human-readable tool name (e.g., "Read", "Edit", "Run") */
	name: string;
	/** Target of the tool (e.g., file basename, command snippet) */
	target: string;
	/** Tool kind for icon lookup (e.g., "read", "edit", "web_search") */
	kind: ToolKind;
}

/**
 * Activity information for streaming sessions.
 */
export interface SessionActivityInfo {
	/** Whether the session is currently streaming */
	isStreaming: boolean;
	/** Todo progress (if any todos exist) */
	todoProgress: TodoProgressInfo | null;
	/** Current tool being executed (if streaming) */
	currentTool: LastToolInfo | null;
	/** Last completed tool (if any) */
	lastTool: LastToolInfo | null;
}

/**
 * Display item for sessions in the list.
 */
export interface SessionListItem {
	id: string;
	title: string;
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc: string | null;
	agentId: string;
	sourcePath?: string;
	createdAt: Date;
	updatedAt: Date;
	/** True when the session should be shown by default in the sidebar */
	isLive: boolean;
	isOpen: boolean;
	/** Activity info (only populated for streaming sessions) */
	activity: SessionActivityInfo | null;
	/** Parent session ID (for subsessions) */
	parentId: string | null;
	/** Total lines added across session edits */
	insertions?: number;
	/** Total lines removed across session edits */
	deletions?: number;
	/** Number of entries in the session */
	entryCount?: number;
	/** Worktree path if this session runs in a worktree */
	worktreePath?: string;
	/** True when the session points to a deleted worktree */
	worktreeDeleted?: boolean;
	/** Associated PR number when session has an associated pull request */
	prNumber?: number;
	/** Current PR state (OPEN, CLOSED, MERGED) */
	prState?: "OPEN" | "CLOSED" | "MERGED";
	/** Canonical PR link ownership mode. */
	prLinkMode?: SessionPrLinkMode;
	/** Shared linked PR summary used across all session surfaces. */
	linkedPr?: SessionLinkedPr;
	/** Per-project sequence ID for Acepe-native sessions */
	sequenceId?: number;
}

/**
 * Group of sessions by project.
 */
export interface SessionGroup {
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc: string | null;
	sessions: SessionListItem[];
}
