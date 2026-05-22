import type { AgentToolStatus } from "./types.js";

export type AgentToolEditDiffInput = {
  filePath?: string | null;
  fileName?: string | null;
  additions?: number;
  deletions?: number;
  oldString?: string | null;
  newString?: string | null;
};

export type ResolvedAgentToolEditDiff = AgentToolEditDiffInput & {
  newString: string;
};

export type AgentToolEditHeaderState =
  | "editing"
  | "edited"
  | "awaitingApproval"
  | "interrupted"
  | "failed"
  | "blocked"
  | "cancelled"
  | "degraded";

export function isEditInProgress(status: AgentToolStatus): boolean {
  return status === "pending" || status === "running";
}

export function resolveEditHeaderState(
  status: AgentToolStatus,
  applied: boolean,
  awaitingApproval: boolean,
): AgentToolEditHeaderState {
  if (status === "error") return "failed";
  if (status === "blocked") return "blocked";
  if (status === "cancelled") return "cancelled";
  if (status === "degraded") return "degraded";
  // Permission / plan gates should read above streaming or “applied” transcript hints.
  if (awaitingApproval) return "awaitingApproval";
  if (isEditInProgress(status)) return "editing";
  if (applied) return "edited";
  return "interrupted";
}

export function shouldShowEditDiffPill(
  status: AgentToolStatus,
  applied: boolean,
  awaitingApproval: boolean,
): boolean {
  return applied || isEditInProgress(status) || awaitingApproval;
}

export function getEditFileName(path?: string | null): string | null {
  if (!path) return null;
  return path.split("/").pop() ?? path;
}

export function resolveEditDiffs(input: {
  diffs: readonly AgentToolEditDiffInput[];
  filePath?: string | null;
  fileName?: string | null;
  additions: number;
  deletions: number;
  oldString?: string | null;
  newString?: string | null;
}): readonly ResolvedAgentToolEditDiff[] {
  if (input.diffs.length > 0) {
    return input.diffs.filter(
      (diff): diff is ResolvedAgentToolEditDiff =>
        typeof diff.newString === "string",
    );
  }

  if (input.newString === null || input.newString === undefined) {
    return [];
  }

  return [
    {
      filePath: input.filePath,
      fileName: input.fileName ?? getEditFileName(input.filePath),
      additions: input.additions,
      deletions: input.deletions,
      oldString: input.oldString,
      newString: input.newString,
    },
  ];
}

export function getEditDisplayModel(input: {
  resolvedDiffs: readonly ResolvedAgentToolEditDiff[];
  filePath?: string | null;
  fileName?: string | null;
  showDiffPill: boolean;
  additions: number;
  deletions: number;
}): {
  hasMultipleDiffs: boolean;
  primaryDiff: ResolvedAgentToolEditDiff | null;
  hasContent: boolean;
  derivedFileName: string | null;
  displayedFilePath: string | null;
  displayedFileCountLabel: string | null;
  displayedAdditions: number;
  displayedDeletions: number;
} {
  const primaryDiff = input.resolvedDiffs[0] ?? null;
  const hasMultipleDiffs = input.resolvedDiffs.length > 1;

  return {
    hasMultipleDiffs,
    primaryDiff,
    hasContent: input.resolvedDiffs.length > 0,
    derivedFileName:
      primaryDiff?.fileName ??
      input.fileName ??
      getEditFileName(primaryDiff?.filePath) ??
      getEditFileName(input.filePath),
    displayedFilePath: primaryDiff?.filePath ?? input.filePath ?? null,
    displayedFileCountLabel:
      input.resolvedDiffs.length === 1
        ? null
        : `${input.resolvedDiffs.length} files`,
    displayedAdditions: input.showDiffPill ? input.additions : 0,
    displayedDeletions: input.showDiffPill ? input.deletions : 0,
  };
}

export function getEditHeaderLabel(
  headerState: AgentToolEditHeaderState,
  labels: {
    editingLabel: string;
    editedLabel: string;
    awaitingApprovalLabel: string;
    interruptedLabel: string;
    failedLabel: string;
    blockedLabel: string;
    cancelledLabel: string;
    degradedLabel: string;
    pendingLabel: string;
  },
): string {
  switch (headerState) {
    case "editing":
      return labels.editingLabel;
    case "edited":
      return labels.editedLabel;
    case "awaitingApproval":
      return labels.awaitingApprovalLabel;
    case "interrupted":
      return labels.interruptedLabel;
    case "failed":
      return labels.failedLabel;
    case "blocked":
      return labels.blockedLabel;
    case "cancelled":
      return labels.cancelledLabel;
    case "degraded":
      return labels.degradedLabel;
  }
}
