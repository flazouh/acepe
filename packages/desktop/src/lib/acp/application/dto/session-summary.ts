import type { SessionEntry } from "./session-entry.js";
import type { SessionIdentity } from "./session-identity.js";
import type { SessionLinkedPr, SessionPrLinkMode } from "./session-linked-pr.js";
import type { SessionStatus } from "./session-status.js";

/**
 * Summary for session list views (without full entries).
 *
 * Extends SessionIdentity with display-relevant fields.
 * Used for rendering session lists without loading full content.
 */
export interface SessionSummary extends SessionIdentity {
	readonly title: string | null;
	readonly status: SessionStatus;
	readonly entryCount: number;
	readonly isConnected: boolean;
	readonly isStreaming: boolean;
	readonly lastEntry?: SessionEntry;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	/** Parent session ID (for subsessions), null if this is a root session */
	readonly parentId: string | null;
	/** Associated PR number when session references a pull request */
	readonly prNumber?: number;
	/** Current PR state (OPEN, CLOSED, MERGED) — ephemeral, updated from live GitHub data */
	readonly prState?: "OPEN" | "CLOSED" | "MERGED";
	/** Canonical PR link ownership mode. */
	readonly prLinkMode?: SessionPrLinkMode;
	/** Shared linked PR summary for sidebar, panel, and kanban projections. */
	readonly linkedPr?: SessionLinkedPr;
	/** True when the session's recorded worktree path no longer exists. */
	readonly worktreeDeleted?: boolean;
	/** Per-project sequence ID for Acepe-native sessions */
	readonly sequenceId?: number;
}
