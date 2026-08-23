import type {
	ActivityId,
	RpcProjectedPendingApproval,
	Sequence,
	SessionId,
	ToolCallId,
} from "@acepe/contracts";
import type { AgentToolEntry, AgentToolStatus } from "@acepe/ui/agent-panel/types";

export type AgentPanelActivityKind = "tool" | "file";

export type AgentPanelActivityStatus = "pending" | "in_progress" | "completed" | "failed";

export type AgentPanelActivityProjection = {
	readonly activityId: ActivityId;
	readonly sessionId: SessionId;
	readonly sequence: Sequence;
	readonly statusSequence: Sequence;
	readonly kind: AgentPanelActivityKind;
	readonly toolCallId: ToolCallId | null;
	readonly operationId: string | null;
	readonly status: AgentPanelActivityStatus;
	readonly title: string;
	readonly path: string | null;
};

const toolStatusFromActivity = (status: AgentPanelActivityStatus): AgentToolStatus => {
	if (status === "in_progress") {
		return "running";
	}
	if (status === "completed") {
		return "done";
	}
	if (status === "failed") {
		return "error";
	}
	return "pending";
};

export const toolRowFromActivityProjection = (
	activity: AgentPanelActivityProjection
): AgentToolEntry => {
	const entry: AgentToolEntry = {
		id: activity.activityId,
		type: "tool_call",
		kind: "unclassified",
		title: activity.title,
		status: toolStatusFromActivity(activity.status),
		presentationState: activity.operationId === null ? "pending_operation" : "resolved",
	};
	if (activity.toolCallId !== null) {
		entry.toolCallId = activity.toolCallId;
	}
	if (activity.operationId !== null) {
		entry.operationId = activity.operationId;
	}
	if (activity.path !== null) {
		entry.filePath = activity.path;
	}
	return entry;
};

export const PERMISSION_PROMPT_TITLE = "Permission required";

export const toolRowFromPendingApproval = (
	approval: RpcProjectedPendingApproval
): AgentToolEntry => {
	const title = approval.title === undefined ? PERMISSION_PROMPT_TITLE : approval.title;
	return {
		id: approval.approvalRequestId,
		type: "tool_call",
		kind: "unclassified",
		title,
		status: "blocked",
		presentationState: "pending_operation",
	};
};
