import type { PermissionReply } from "./permission.js";
import type { QuestionAnswer } from "./question.js";
import type { InteractionReplyHandler } from "./reply-handler.js";

interface InteractionReplyRequestBase {
	sessionId: string;
	interactionId?: string;
	replyHandler: InteractionReplyHandler;
}

export interface PermissionInteractionReplyRequest extends InteractionReplyRequestBase {
	payload: {
		kind: "permission";
		reply: PermissionReply;
		optionId: string;
	};
}

export interface QuestionInteractionReplyRequest extends InteractionReplyRequestBase {
	payload: {
		kind: "question";
		answers: QuestionAnswer[];
		answerMap: Record<string, string | string[]>;
	};
}

export interface QuestionCancelInteractionReplyRequest extends InteractionReplyRequestBase {
	payload: {
		kind: "question_cancel";
	};
}

export interface PlanApprovalInteractionReplyRequest extends InteractionReplyRequestBase {
	payload: {
		kind: "plan_approval";
		approved: boolean;
	};
}

export type InteractionReplyRequest =
	| PermissionInteractionReplyRequest
	| QuestionInteractionReplyRequest
	| QuestionCancelInteractionReplyRequest
	| PlanApprovalInteractionReplyRequest;
