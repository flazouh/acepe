import type { SectionedFeedSectionId } from "../attention-queue/types.js";

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
	readonly modeLabel: string | null;
	readonly diffInsertions: number;
	readonly diffDeletions: number;
	readonly errorText: string | null;
	readonly todoProgress: { current: number; total: number } | null;
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