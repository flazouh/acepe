import type { TodoProgressInfo } from "$lib/acp/components/session-list/session-list-types.js";
import type { ToolCall } from "$lib/acp/types/tool-call.js";
import type { ToolKind } from "$lib/acp/types/tool-kind.js";

import type { SessionState } from "../session-state.js";

import type { ThreadBoardStatus } from "./thread-board-status.js";

export interface ThreadBoardSource {
	readonly panelId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly autonomousEnabled: boolean;
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
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
	readonly state: SessionState;
	readonly sequenceId: number | null;
}

export interface ThreadBoardItem {
	readonly panelId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly autonomousEnabled: boolean;
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
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
	readonly state: SessionState;
	readonly sequenceId: number | null;
	readonly status: ThreadBoardStatus;
}

export interface ThreadBoardGroup {
	readonly status: ThreadBoardStatus;
	readonly items: readonly ThreadBoardItem[];
}
