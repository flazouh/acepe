/**
 * Session attention types - Type definitions for live sessions needing attention.
 */

import type { SessionStatus } from "../../application/dto/session-status.js";
import type { TodoProgressInfo } from "../../components/session-list/session-list-types.js";
import type {
	ComputerPermissionInteraction,
	PlanApprovalInteraction,
} from "../../types/interaction.js";
import type { QuestionRequest } from "../../types/question.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";
import type { SessionState } from "../session-state.js";
import type { SessionWorkBucket } from "../session-work-projection.js";
import type { UrgencyInfo } from "../urgency.js";

/**
 * Session attention item representing a live session that may need user attention.
 *
 * @alias QueueItem kept for backward compatibility during migration.
 */
export interface SessionAttentionItem {
	/** Session ID */
	readonly sessionId: string;
	/** Panel ID if session is open in a panel, null otherwise */
	readonly panelId: string | null;
	/** Agent ID (e.g., 'claude', 'cursor') */
	readonly agentId: string;
	/** Project path */
	readonly projectPath: string;
	/** Project name (extracted from path) */
	readonly projectName: string;
	/** Disambiguating badge label for projects with similar names */
	readonly projectBadgeLabel: string | null;
	/** Project color for badge */
	readonly projectColor: string;
	/** Project icon source for badge */
	readonly projectIconSrc: string | null;
	/** Session title */
	readonly title: string | null;
	/** Urgency information */
	readonly urgency: UrgencyInfo;
	/** Text to display (question or permission description) */
	readonly pendingText: string | null;
	/** Todo progress from canonical operation-backed tool calls. */
	readonly todoProgress: TodoProgressInfo | null;
	/** Timestamp of last activity */
	readonly lastActivityAt: number;
	/** Current tool kind for icon display (streaming tool, if any) */
	readonly currentToolKind: ToolKind | null;
	/** Current streaming tool call message (for registry-based display) */
	readonly currentStreamingToolCall: ToolCall | null;
	/** Last tool kind (most recent tool, streaming or completed) */
	readonly lastToolKind: ToolKind | null;
	/** Last tool call (most recent tool, streaming or completed) */
	readonly lastToolCall: ToolCall | null;
	/** Current mode ID (e.g. "plan", "code") */
	readonly currentModeId: string | null;
	/** Total lines added across all edits in this session */
	readonly insertions: number;
	/** Total lines deleted across all edits in this session */
	readonly deletions: number;
	/** Full pending question data (if any) */
	readonly pendingQuestion: QuestionRequest | null;
	/** Full pending plan approval data (if any) */
	readonly pendingPlanApproval: PlanApprovalInteraction | null;
	/** Full pending computer permission data (if any) */
	readonly pendingComputerPermission: ComputerPermissionInteraction | null;
	/** Session status for filtering */
	readonly status: SessionStatus;
	/** Canonical-derived work bucket for filtering/grouping. */
	readonly workBucket: SessionWorkBucket;
	/** Connection/agent error message when present */
	readonly connectionError: string | null;
	/** Canonical failed-turn state when the latest turn ended in error. */
	readonly activeTurnFailure?: ActiveTurnFailure | null;
	/**
	 * Per-project session sequence label (e.g. G7 → letter G, number 7).
	 */
	readonly sequenceId: number | null;
	/**
	 * Unified session state model.
	 * Use this for queue classification instead of individual boolean flags.
	 */
	readonly state: SessionState;
}

/** @alias SessionAttentionItem kept for backward compatibility. */
export type QueueItem = SessionAttentionItem;
