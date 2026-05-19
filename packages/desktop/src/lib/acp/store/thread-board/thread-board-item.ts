import type { TodoProgressInfo } from "$lib/acp/components/session-list/session-list-types.js";
import type { SessionStatus } from "$lib/acp/application/dto/session-status.js";
import type { ToolCall } from "$lib/acp/types/tool-call.js";
import type { ToolKind } from "$lib/acp/types/tool-kind.js";
import type { ActiveTurnFailure } from "$lib/acp/types/turn-error.js";
import type { SessionLinkedPr } from "../../application/dto/session-linked-pr.js";

import type { SessionState } from "../session-state.js";
import type { SessionWorkBucket } from "../session-work-projection.js";

import type { ThreadBoardStatus } from "./thread-board-status.js";

export interface ThreadBoardSource {
	readonly panelId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly autonomousEnabled: boolean | null;
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly projectIconSrc: string | null;
	readonly title: string | null;
	readonly lastActivityAt: number;
	readonly currentModeId: string | null;
	readonly currentToolKind: ToolKind | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly lastToolKind: ToolKind | null;
	readonly lastToolCall: ToolCall | null;
	readonly insertions: number;
	readonly deletions: number;
	readonly todoProgress: TodoProgressInfo | null;
	readonly connectionError: string | null;
	readonly activeTurnFailure?: ActiveTurnFailure | null;
	readonly sessionStatus: SessionStatus;
	readonly state: SessionState;
	readonly workBucket: SessionWorkBucket;
	readonly sequenceId: number | null;
	readonly worktreePath?: string | null;
	readonly worktreeDeleted?: boolean;
	readonly linkedPr?: SessionLinkedPr | null;
}

export interface ThreadBoardItem {
	readonly panelId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly autonomousEnabled: boolean | null;
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly projectIconSrc: string | null;
	readonly title: string | null;
	readonly lastActivityAt: number;
	readonly currentModeId: string | null;
	readonly currentToolKind: ToolKind | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly lastToolKind: ToolKind | null;
	readonly lastToolCall: ToolCall | null;
	readonly insertions: number;
	readonly deletions: number;
	readonly todoProgress: TodoProgressInfo | null;
	readonly connectionError: string | null;
	readonly activeTurnFailure?: ActiveTurnFailure | null;
	readonly sessionStatus: SessionStatus;
	readonly state: SessionState;
	readonly workBucket: SessionWorkBucket;
	readonly sequenceId: number | null;
	readonly worktreePath?: string | null;
	readonly worktreeDeleted?: boolean;
	readonly linkedPr?: SessionLinkedPr | null;
	readonly status: ThreadBoardStatus;
}

export interface ThreadBoardGroup {
	readonly status: ThreadBoardStatus;
	readonly items: readonly ThreadBoardItem[];
}
