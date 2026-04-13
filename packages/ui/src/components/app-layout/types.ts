export type AppTabStatus = "idle" | "running" | "done" | "error" | "unseen" | "question";
export type AppTabMode = "build" | "plan" | null;

export interface AppTab {
  id: string;
  title: string;
  projectName?: string;
  projectColor?: string;
  agentIconSrc?: string;
  mode?: AppTabMode;
  status?: AppTabStatus;
  isFocused?: boolean;
  /** Text shown in the tooltip on hover */
  tooltipText?: string;
}

export interface AppSessionItem {
  id: string;
  title: string;
  agentIconSrc?: string;
  status?: AppTabStatus;
  isActive?: boolean;
}

export interface AppProjectGroup {
  name: string;
  color?: string;
  iconSrc?: string | null;
  sessions: AppSessionItem[];
}

export interface AppTabGroup {
  projectName: string;
  projectColor: string;
  tabs: AppTab[];
}
