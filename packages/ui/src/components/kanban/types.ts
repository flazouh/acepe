import type { AgentToolEntry } from "../agent-panel/types.js";
import type { SectionedFeedSectionId } from "../attention-queue/types.js";

export interface KanbanToolData {
	readonly id: string;
	readonly kind?: string;
	readonly title: string;
	readonly filePath?: string;
	readonly status: "pending" | "running" | "done" | "error";
}

export interface KanbanCardData {
	readonly id: string;
	readonly title: string | null;
	readonly agentIconSrc: string;
	readonly agentLabel: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly sequenceId: number | null;
	readonly timeAgo: string;
	readonly activityText: string | null;
	readonly isStreaming: boolean;
	readonly modeId: string | null;
	readonly diffInsertions: number;
	readonly diffDeletions: number;
	readonly errorText: string | null;
	readonly todoProgress: { current: number; total: number } | null;
	readonly latestTool: KanbanToolData | null;
	readonly toolCalls: readonly AgentToolEntry[];
}

export interface KanbanColumnGroup {
	readonly id: SectionedFeedSectionId;
	readonly label: string;
	readonly items: readonly KanbanCardData[];
}

export interface KanbanPermissionData {
	readonly label: string;
	readonly command: string | null;
	readonly filePath: string | null;
}

export interface KanbanQuestionOption {
	readonly label: string;
	readonly selected: boolean;
}

export interface KanbanQuestionData {
	readonly questionText: string;
	readonly options: readonly KanbanQuestionOption[];
	readonly canSubmit: boolean;
}