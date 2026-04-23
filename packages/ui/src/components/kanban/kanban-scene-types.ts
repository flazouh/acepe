import type { AgentToolKind } from "../agent-panel/types.js";
import type {
	ActivityEntryQuestion,
	ActivityEntryQuestionOption,
	ActivityEntryQuestionProgress,
	SectionedFeedSectionId,
} from "../attention-queue/types.js";
import type { KanbanCardData, KanbanPrFooterData } from "./types.js";

export interface KanbanSceneMenuAction {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly destructive?: boolean;
}

export interface KanbanSceneQuestionFooterData {
	readonly kind: "question";
	readonly currentQuestion: ActivityEntryQuestion;
	readonly totalQuestions: number;
	readonly hasMultipleQuestions: boolean;
	readonly currentQuestionIndex: number;
	readonly questionId: string;
	readonly questionProgress: readonly ActivityEntryQuestionProgress[];
	readonly currentQuestionAnswered: boolean;
	readonly currentQuestionOptions: readonly ActivityEntryQuestionOption[];
	readonly otherText: string;
	readonly otherPlaceholder: string;
	readonly showOtherInput: boolean;
	readonly showSubmitButton: boolean;
	readonly canSubmit: boolean;
	readonly submitLabel: string;
}

export interface KanbanScenePermissionFooterData {
	readonly kind: "permission";
	readonly label: string;
	readonly command: string | null;
	readonly filePath: string | null;
	readonly toolKind: AgentToolKind | null;
	readonly progress: { current: number; total: number; label: string } | null;
	readonly allowAlwaysLabel?: string;
	readonly approveLabel: string;
	readonly rejectLabel: string;
}

export interface KanbanScenePlanApprovalFooterData {
	readonly kind: "plan_approval";
	readonly prompt: string;
	readonly approveLabel: string;
	readonly rejectLabel: string;
}

export type KanbanSceneFooterData =
	| KanbanSceneQuestionFooterData
	| KanbanScenePermissionFooterData
	| KanbanScenePlanApprovalFooterData;

export type KanbanScenePrFooterData = KanbanPrFooterData;

export interface KanbanSceneCardData extends KanbanCardData {
	readonly footer: KanbanSceneFooterData | null;
	readonly prFooter: KanbanScenePrFooterData | null;
	readonly menuActions: readonly KanbanSceneMenuAction[];
	readonly showCloseAction: boolean;
	readonly hideBody: boolean;
	readonly flushFooter: boolean;
}

export interface KanbanSceneColumnData {
	readonly id: SectionedFeedSectionId;
	readonly label: string;
}

export type KanbanScenePlacementSource = "session" | "optimistic";

export interface KanbanScenePlacement {
	readonly cardId: string;
	readonly columnId: SectionedFeedSectionId;
	readonly index: number;
	readonly orderKey: string;
	readonly source: KanbanScenePlacementSource;
}

export interface KanbanSceneModel {
	readonly columns: readonly KanbanSceneColumnData[];
	readonly cards: readonly KanbanSceneCardData[];
	readonly placements: readonly KanbanScenePlacement[];
}

export interface KanbanSceneColumnGroup {
	readonly id: SectionedFeedSectionId;
	readonly label: string;
	readonly items: readonly KanbanSceneCardData[];
}
