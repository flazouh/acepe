import type {
	AgentToolEntry,
	AgentToolKind,
	AgentToolStatus,
} from "../agent-panel/types.js";
import type { PrChecksItem } from "../pr-checks/types.js";
import type { SectionedFeedSectionId } from "../attention-queue/types.js";

export interface KanbanToolData {
	readonly id: string;
	readonly kind?: AgentToolKind;
	readonly title: string;
	readonly subtitle?: string;
	readonly filePath?: string;
	readonly status: AgentToolStatus;
}

export interface KanbanTaskCardData {
	readonly summary: string;
	readonly isStreaming: boolean;
	readonly latestTool: KanbanToolData | null;
	readonly toolCalls: readonly AgentToolEntry[];
}

export interface KanbanPrFooterData {
	readonly prNumber: number;
	readonly state: "OPEN" | "CLOSED" | "MERGED";
	readonly title: string | null;
	readonly url: string | null;
	readonly additions: number | null;
	readonly deletions: number | null;
	readonly isLoading: boolean;
	readonly hasResolvedDetails: boolean;
	readonly checks: readonly PrChecksItem[];
	readonly isChecksLoading: boolean;
	readonly hasResolvedChecks: boolean;
	readonly onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
}

export interface KanbanCardData {
	readonly id: string;
	readonly title: string | null;
	/** Token-preserved title for rendering artifact chips. When non-null, render via RichTokenText. */
	readonly richTitle?: string | null;
	readonly agentIconSrc: string;
	readonly agentLabel: string;
	readonly isAutoMode: boolean;
	readonly projectName: string;
	readonly projectColor: string;
	readonly projectIconSrc?: string | null;
	readonly activityText: string | null;
	readonly isStreaming: boolean;
	readonly modeId: string | null;
	readonly diffInsertions: number;
	readonly diffDeletions: number;
	readonly errorText: string | null;
	readonly todoProgress: { current: number; total: number; label: string } | null;
	readonly taskCard: KanbanTaskCardData | null;
	readonly latestTool: KanbanToolData | null;
	readonly hasUnseenCompletion: boolean;
	readonly sequenceId: number | null;
	readonly isWorktreeSession?: boolean;
	readonly worktreeDeleted?: boolean;
	readonly prFooter?: KanbanPrFooterData | null;
	readonly hideHeaderDiff?: boolean;
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

export interface KanbanPermissionData {
	readonly label: string;
	readonly command?: string;
	readonly filePath?: string;
	readonly toolKind?: AgentToolKind | null;
	readonly progress?: { current: number; total: number; label: string } | null;
	readonly approveLabel?: string;
	readonly rejectLabel?: string;
}
