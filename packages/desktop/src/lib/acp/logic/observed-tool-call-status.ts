/**
 * Shared status vocabulary for a tool call as any producer of canonical
 * transcript data (live orchestration events, reopened-session activities)
 * observes it. Used by both `orchestration-canonical-bridge.ts` (live) and
 * `reopen-snapshot-graph.ts` (reopen) so the two producers can't drift on
 * what "in_progress" means as an `OperationState`/`ToolCallStatus`.
 */
import type { OperationState, ToolCallStatus } from "../../services/acp-types.js";

export type ObservedToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export function observedStatusToOperationState(status: ObservedToolCallStatus): OperationState {
	switch (status) {
		case "pending":
			return "pending";
		case "in_progress":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
	}
}

export function observedStatusToToolCallStatus(status: ObservedToolCallStatus): ToolCallStatus {
	return status;
}
