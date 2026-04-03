export type SectionedFeedSectionId =
  | "answer_needed"
  | "working"
  | "planning"
  | "finished"
  | "idle"
  | "error";

export interface SectionedFeedGroup<TItem> {
  readonly id: SectionedFeedSectionId;
  readonly label: string;
  readonly items: readonly TItem[];
}

export type SectionedFeedItemData = object;

export type ActivityEntryMode = "plan" | "build" | null;

export interface ActivityEntryTodoProgress {
  readonly current: number;
  readonly total: number;
  readonly label: string;
}

export interface ActivityEntryQuestion {
  readonly question: string;
  readonly multiSelect: boolean;
  readonly options: readonly {
    readonly label: string;
  }[];
}

export interface ActivityEntryQuestionOption {
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly color: string;
}

export interface ActivityEntryQuestionProgress {
  readonly questionIndex: number;
  readonly answered: boolean;
}
