import type {
	AgentToolEntry,
	AgentToolKind,
	AgentToolStatus,
} from "../agent-panel/types.js";
import type { SectionedFeedSectionId } from "../attention-queue/types.js";

export interface KanbanToolData {
	readonly id: string;
	readonly kind?: AgentToolKind;
	readonly title: string;
	readonly filePath?: string;
	readonly status: AgentToolStatus;
}

export interface KanbanTaskCardData {
	readonly summary: string;
	readonly isStreaming: boolean;
	readonly latestTool: KanbanToolData | null;
	readonly toolCalls: readonly AgentToolEntry[];
}

export interface KanbanCardData {
	readonly id: string;
	readonly title: string | null;
	readonly agentIconSrc: string;
	readonly agentLabel: string;
	readonly projectName: string;
	readonly projectColor: string;
	readonly timeAgo: string;
	readonly activityText: string | null;
	readonly isStreaming: boolean;
	readonly modeId: string | null;
	readonly diffInsertions: number;
	readonly diffDeletions: number;
	readonly errorText: string | null;
	readonly todoProgress: { current: number; total: number; label: string } | null;
	readonly taskCard: KanbanTaskCardData | null;
	readonly latestTool: KanbanToolData | null;
}

export interface KanbanColumnGroup {
	readonly id: SectionedFeedSectionId;
	readonly label: string;
	readonly items: readonly KanbanCardData[];
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