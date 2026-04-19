export type AppTabStatus = "idle" | "running" | "done" | "error" | "unseen" | "question";
export type AppTabMode = "build" | "plan" | null;

export interface AppTab {
  id: string;
  title: string;
  projectName?: string;
  projectColor?: string;
  projectIconSrc?: string | null;
  agentIconSrc?: string;
  mode?: AppTabMode;
  status?: AppTabStatus;
  isFocused?: boolean;
  /** Text shown in the tooltip on hover */
  tooltipText?: string;
}

export type AppSessionPrState = "OPEN" | "CLOSED" | "MERGED";

export interface AppSessionItem {
  id: string;
  title: string;
  agentIconSrc?: string;
  status?: AppTabStatus;
  isActive?: boolean;
  /** Relative timestamp shown trailing the title row (e.g. "2m ago"). */
  timeAgo?: string;
  /** Secondary line beneath the title — e.g. "Read src/foo.ts" or last action. */
  lastActionText?: string;
  /** When true, render an animated shimmer / pinging dot to signal activity. */
  isStreaming?: boolean;
  /** Diff-pill numerators. Omit or 0 to hide the diff pill. */
  insertions?: number;
  deletions?: number;
  /** Project metadata for the inline letter / icon badge (used for subsessions). */
  projectName?: string;
  projectColor?: string;
  projectIconSrc?: string | null;
  /** Per-project sequence id rendered in the project letter badge. */
  sequenceId?: number;
  /** When set, renders a tree icon indicating the session runs in a worktree. */
  worktreePath?: string;
  /** When true, renders the worktree icon in destructive color. */
  worktreeDeleted?: boolean;
  /** Optional PR badge (e.g. `#1234`). */
  prNumber?: number;
  prState?: AppSessionPrState;
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
  projectIconSrc?: string | null;
  tabs: AppTab[];
}

export interface AppSidebarProjectHeaderAgent {
  id: string;
  name: string;
  iconSrc: string;
  selected: boolean;
}
