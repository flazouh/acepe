import type { AgentToolStatus } from "./types.js";

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
