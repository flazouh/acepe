import type { CanonicalSessionProjection } from "../../store/canonical-session-projection.js";
import type { SessionCold } from "./session-cold.js";
import type { SessionEntry } from "./session-entry.js";
import type { SessionIdentity } from "./session-identity.js";
import type { SessionLinkedPr, SessionPrLinkMode } from "./session-linked-pr.js";
import type { SessionStatus } from "./session-status.js";

export interface SessionListState {
	readonly status: SessionStatus;
	readonly isConnected: boolean;
	readonly isStreaming: boolean;
}

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

export function buildSessionSummaryFromCold(input: {
	readonly cold: SessionCold;
	readonly listState: SessionListState;
	readonly entryCount: number;
	readonly lastEntry?: SessionEntry;
}): SessionSummary {
	return {
		id: input.cold.id,
		projectPath: input.cold.projectPath,
		agentId: input.cold.agentId,
		worktreePath: input.cold.worktreePath,
		title: input.cold.title,
		status: input.listState.status,
		entryCount: input.entryCount,
		isConnected: input.listState.isConnected,
		isStreaming: input.listState.isStreaming,
		lastEntry: input.lastEntry,
		createdAt: input.cold.createdAt,
		updatedAt: input.cold.updatedAt,
		parentId: input.cold.parentId,
		prNumber: input.cold.prNumber,
		prState: input.cold.prState,
		prLinkMode: input.cold.prLinkMode,
		linkedPr: input.cold.linkedPr,
		worktreeDeleted: input.cold.worktreeDeleted,
		sequenceId: input.cold.sequenceId,
	};
}

export function deriveSessionListStateFromCanonical(
	projection: CanonicalSessionProjection | null
): SessionListState {
	if (projection === null) {
		return {
			status: "error",
			isConnected: false,
			isStreaming: false,
		};
	}

	if (
		projection.lifecycle.status === "activating" ||
		projection.lifecycle.status === "reconnecting"
	) {
		return {
			status: "connecting",
			isConnected: false,
			isStreaming: false,
		};
	}

	if (projection.lifecycle.status === "failed") {
		return {
			status: "error",
			isConnected: false,
			isStreaming: false,
		};
	}

	if (
		projection.lifecycle.status === "reserved" ||
		projection.lifecycle.status === "detached" ||
		projection.lifecycle.status === "archived"
	) {
		return {
			status: "idle",
			isConnected: false,
			isStreaming: false,
		};
	}

	if (projection.activity.kind === "error") {
		return {
			status: "error",
			isConnected: false,
			isStreaming: false,
		};
	}

	if (projection.activity.kind === "paused") {
		return {
			status: "paused",
			isConnected: true,
			isStreaming: false,
		};
	}

	if (
		projection.activity.kind === "running_operation" ||
		projection.activity.kind === "awaiting_model" ||
		projection.activity.kind === "waiting_for_user" ||
		projection.turnState === "Running"
	) {
		return {
			status: "streaming",
			isConnected: true,
			isStreaming: true,
		};
	}

	return {
		status: "ready",
		isConnected: true,
		isStreaming: false,
	};
}
