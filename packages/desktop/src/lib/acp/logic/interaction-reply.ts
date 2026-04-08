import type { ResultAsync } from "neverthrow";

import { type AppError } from "../errors/app-error.js";
import { api } from "../store/api.js";
import type { PlanApprovalInteraction } from "../types/interaction.js";
import type { InteractionReplyRequest } from "../types/interaction-reply-request.js";
import type { PermissionReply, PermissionRequest } from "../types/permission.js";
import type { QuestionAnswer, QuestionRequest } from "../types/question.js";
import {
	createLegacyInteractionReplyHandler,
	type InteractionReplyHandler,
} from "../types/reply-handler.js";

interface InteractionReplyTarget {
	sessionId: string;
	id?: string;
	jsonRpcRequestId?: number;
	replyHandler?: InteractionReplyHandler;
}

type PlanApprovalReplyTarget =
	| PlanApprovalInteraction
	| {
			sessionId: string;
			jsonRpcRequestId: number;
			replyHandler?: InteractionReplyHandler;
			id?: string;
	  };

function resolveReplyHandler(target: InteractionReplyTarget): InteractionReplyHandler {
	return (
		target.replyHandler ??
		createLegacyInteractionReplyHandler(target.id ?? target.sessionId, target.jsonRpcRequestId)
	);
}

function createInteractionReplyRequest(
	target: InteractionReplyTarget,
	payload: InteractionReplyRequest["payload"]
): InteractionReplyRequest {
	const base = {
		sessionId: target.sessionId,
		interactionId: target.id,
		replyHandler: resolveReplyHandler(target),
	};

	switch (payload.kind) {
		case "permission":
			return {
				sessionId: base.sessionId,
				interactionId: base.interactionId,
				replyHandler: base.replyHandler,
				payload: {
					kind: "permission",
					reply: payload.reply,
					optionId: payload.optionId,
				},
			};
		case "question":
			return {
				sessionId: base.sessionId,
				interactionId: base.interactionId,
				replyHandler: base.replyHandler,
				payload: {
					kind: "question",
					answers: payload.answers,
					answerMap: payload.answerMap,
				},
			};
		case "question_cancel":
			return {
				sessionId: base.sessionId,
				interactionId: base.interactionId,
				replyHandler: base.replyHandler,
				payload: {
					kind: "question_cancel",
				},
			};
		case "plan_approval":
			return {
				sessionId: base.sessionId,
				interactionId: base.interactionId,
				replyHandler: base.replyHandler,
				payload: {
					kind: "plan_approval",
					approved: payload.approved,
				},
			};
	}
}

export function replyToPermissionRequest(
	permission: PermissionRequest,
	reply: PermissionReply,
	optionId: string
): ResultAsync<void, AppError> {
	return api.replyInteraction(
		createInteractionReplyRequest(permission, {
			kind: "permission",
			reply,
			optionId,
		})
	);
}

export function replyToQuestionRequest(
	question: QuestionRequest,
	answers: QuestionAnswer[],
	answerMap: Record<string, string | string[]>
): ResultAsync<void, AppError> {
	return api.replyInteraction(
		createInteractionReplyRequest(question, {
			kind: "question",
			answers,
			answerMap,
		})
	);
}

export function cancelQuestionRequest(question: QuestionRequest): ResultAsync<void, AppError> {
	return api.replyInteraction(
		createInteractionReplyRequest(question, {
			kind: "question_cancel",
		})
	);
}

export function replyToPlanApprovalRequest(
	targetOrSessionId: PlanApprovalReplyTarget | string,
	jsonRpcRequestIdOrApproved: number | boolean,
	approved: boolean
): ResultAsync<void, AppError> {
	const target: PlanApprovalReplyTarget =
		typeof targetOrSessionId === "string"
			? {
					sessionId: targetOrSessionId,
					jsonRpcRequestId: jsonRpcRequestIdOrApproved as number,
				}
			: targetOrSessionId;
	const resolvedApproved =
		typeof targetOrSessionId === "string"
			? approved
			: (jsonRpcRequestIdOrApproved as boolean);

	return api.replyInteraction(
		createInteractionReplyRequest(target, {
			kind: "plan_approval",
			approved: resolvedApproved,
		})
	);
}
