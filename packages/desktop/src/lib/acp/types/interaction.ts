import type { PermissionRequest } from "./permission.js";
import type { AnsweredQuestion, QuestionRequest } from "./question.js";
import type { InteractionReplyHandler } from "./reply-handler.js";
import type { ComputerPermissionKind } from "../../services/acp-types.js";

export type InteractionKind = "permission" | "question" | "plan_approval" | "computer_permission";

export interface InteractionToolReference {
	messageID: string | null;
	callID: string;
}

export interface PermissionInteraction {
	id: string;
	kind: "permission";
	request: PermissionRequest;
}

export interface QuestionInteraction {
	id: string;
	kind: "question";
	request: QuestionRequest;
	answered?: AnsweredQuestion;
}

export interface PlanApprovalInteraction {
	id: string;
	kind: "plan_approval";
	source: "create_plan" | "exit_plan_mode";
	sessionId: string;
	tool: InteractionToolReference;
	jsonRpcRequestId?: number;
	replyHandler: InteractionReplyHandler;
	status: "pending" | "approved" | "rejected";
	canonicalOperationId?: string | null;
}

export interface ComputerPermissionInteraction {
	id: string;
	kind: "computer_permission";
	sessionId: string;
	permissionKind: ComputerPermissionKind;
	reason: string;
	app?: string | null;
	window?: string | null;
	tool?: InteractionToolReference;
	status: "pending" | "approved" | "rejected";
	canonicalOperationId?: string | null;
}

export type Interaction =
	| PermissionInteraction
	| QuestionInteraction
	| PlanApprovalInteraction
	| ComputerPermissionInteraction;

export function buildPlanApprovalInteractionId(
	sessionId: string,
	toolCallId: string,
	jsonRpcRequestId: number
): string {
	return `${sessionId}\u0000${toolCallId}\u0000plan\u0000${jsonRpcRequestId}`;
}
