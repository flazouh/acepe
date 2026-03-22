import type { AgentToolStatus } from "./types.js";

export type AgentToolEditHeaderState =
  | "editing"
  | "edited"
  | "awaitingApproval"
  | "interrupted"
  | "failed";

export function isEditInProgress(status: AgentToolStatus): boolean {
  return status === "pending" || status === "running";
}

export function resolveEditHeaderState(
  status: AgentToolStatus,
  applied: boolean,
  awaitingApproval: boolean,
): AgentToolEditHeaderState {
  if (status === "error") return "failed";
  if (isEditInProgress(status)) return "editing";
  if (applied) return "edited";
  if (awaitingApproval) return "awaitingApproval";
  return "interrupted";
}

export function shouldShowEditDiffPill(
  status: AgentToolStatus,
  applied: boolean,
  awaitingApproval: boolean,
): boolean {
  return applied || isEditInProgress(status) || awaitingApproval;
}
