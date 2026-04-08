import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type {
	InteractionResponse,
	InteractionSnapshot,
	JsonValue,
	PermissionData,
	QuestionData,
	QuestionItem,
	SessionProjectionSnapshot,
	ToolReference,
} from "../../services/acp-types.js";
import type { PlanApprovalInteraction } from "../types/interaction.js";
import { createPermissionRequest, type PermissionRequest } from "../types/permission.js";
import type { AnsweredQuestion, QuestionRequest } from "../types/question.js";

const INTERACTION_STORE_KEY = Symbol("interaction-store");

export class InteractionStore {
	readonly permissionsPending = new SvelteMap<string, PermissionRequest>();
	readonly questionsPending = new SvelteMap<string, QuestionRequest>();
	readonly answeredQuestions = new SvelteMap<string, AnsweredQuestion>();
	readonly planApprovalsPending = new SvelteMap<string, PlanApprovalInteraction>();
	private readonly answeredQuestionSessionIds = new SvelteMap<string, string>();

	setPlanApprovalStatus(
		interactionId: string,
		status: PlanApprovalInteraction["status"]
	): void {
		const approval = this.planApprovalsPending.get(interactionId);
		if (approval === undefined) {
			return;
		}

		this.planApprovalsPending.set(interactionId, {
			id: approval.id,
			kind: approval.kind,
			source: approval.source,
			sessionId: approval.sessionId,
			tool: {
				messageID: approval.tool.messageID,
				callID: approval.tool.callID,
			},
			jsonRpcRequestId: approval.jsonRpcRequestId,
			status,
		});
	}

	clearSession(sessionId: string): void {
		for (const [interactionId, permission] of this.permissionsPending) {
			if (permission.sessionId === sessionId) {
				this.permissionsPending.delete(interactionId);
			}
		}

		for (const [interactionId, question] of this.questionsPending) {
			if (question.sessionId === sessionId) {
				this.questionsPending.delete(interactionId);
			}
		}

		for (const [toolCallId, answeredSessionId] of this.answeredQuestionSessionIds) {
			if (answeredSessionId === sessionId) {
				this.answeredQuestionSessionIds.delete(toolCallId);
				this.answeredQuestions.delete(toolCallId);
			}
		}

		for (const [interactionId, approval] of this.planApprovalsPending) {
			if (approval.sessionId === sessionId) {
				this.planApprovalsPending.delete(interactionId);
			}
		}
	}

	replaceSessionProjection(projection: SessionProjectionSnapshot): void {
		const sessionId =
			projection.session?.session_id ?? projection.interactions[0]?.session_id;
		if (sessionId === undefined) {
			return;
		}

		this.clearSession(sessionId);
		for (const interaction of projection.interactions) {
			this.applyProjectionInteraction(interaction);
		}
	}

	private applyProjectionInteraction(interaction: InteractionSnapshot): void {
		if ("Permission" in interaction.payload) {
			this.applyPermissionInteraction(interaction, interaction.payload.Permission);
			return;
		}

		if ("Question" in interaction.payload) {
			this.applyQuestionInteraction(interaction, interaction.payload.Question);
			return;
		}

		if ("PlanApproval" in interaction.payload) {
			this.applyPlanApprovalInteraction(interaction, interaction.payload.PlanApproval.source);
		}
	}

	private applyPermissionInteraction(
		interaction: InteractionSnapshot,
		payload: PermissionData
	): void {
		if (interaction.state !== "Pending") {
			return;
		}
		this.permissionsPending.set(
			interaction.id,
			createPermissionRequest({
				id: payload.id,
				sessionId: payload.sessionId,
				jsonRpcRequestId: payload.jsonRpcRequestId,
				permission: payload.permission,
				patterns: payload.patterns,
				metadata: payload.metadata,
				always: payload.always,
				tool: payload.tool,
			})
		);
	}

	private applyQuestionInteraction(interaction: InteractionSnapshot, payload: QuestionData): void {
		const request = this.buildQuestionRequest(payload);
		if (interaction.state === "Pending") {
			this.questionsPending.set(request.id, request);
			return;
		}

		if (interaction.state !== "Answered" && interaction.state !== "Rejected") {
			return;
		}

		const toolCallId = request.tool?.callID ?? request.id;
		const answeredQuestion: AnsweredQuestion = {
			questions: request.questions,
			answers: this.extractQuestionAnswers(request.questions, interaction.response),
			answeredAt: interaction.responded_at_event_seq ?? 0,
			cancelled: interaction.state === "Rejected" ? true : undefined,
		};
		this.answeredQuestionSessionIds.set(toolCallId, interaction.session_id);
		this.answeredQuestions.set(toolCallId, answeredQuestion);
	}

	private applyPlanApprovalInteraction(
		interaction: InteractionSnapshot,
		source: "CreatePlan" | "ExitPlanMode"
	): void {
		const jsonRpcRequestId = interaction.json_rpc_request_id;
		const tool = toInteractionToolReference(interaction.tool_reference);
		const status = mapPlanApprovalStatus(interaction.state);
		if (jsonRpcRequestId === null || tool === undefined || status === null) {
			return;
		}

		this.planApprovalsPending.set(interaction.id, {
			id: interaction.id,
			kind: "plan_approval",
			source: source === "CreatePlan" ? "create_plan" : "exit_plan_mode",
			sessionId: interaction.session_id,
			tool,
			jsonRpcRequestId,
			status,
		});
	}

	private buildQuestionRequest(payload: QuestionData): QuestionRequest {
		return {
			id: payload.id,
			sessionId: payload.sessionId,
			jsonRpcRequestId: payload.jsonRpcRequestId ?? undefined,
			questions: payload.questions,
			tool: toInteractionToolReference(payload.tool),
		};
	}

	private extractQuestionAnswers(
		questions: QuestionItem[],
		response: InteractionResponse | null
	): Record<string, string | string[]> {
		if (response === null || response.kind !== "question") {
			return {};
		}

		const answers = response.answers;
		if (Array.isArray(answers)) {
			return extractQuestionAnswersFromArray(questions, answers);
		}

		if (typeof answers === "object" && answers !== null) {
			return extractQuestionAnswersFromObject(questions, answers);
		}

		return {};
	}
}

function toInteractionToolReference(
	tool: ToolReference | null | undefined
): { messageID: string; callID: string } | undefined {
	if (tool === undefined || tool === null) {
		return undefined;
	}

	return {
		messageID: tool.messageId,
		callID: tool.callId,
	};
}

function extractQuestionAnswersFromArray(
	questions: QuestionItem[],
	answers: JsonValue[]
): Record<string, string | string[]> {
	const answerMap: Record<string, string | string[]> = {};
	for (let index = 0; index < questions.length; index += 1) {
		const question = questions[index];
		if (question === undefined) {
			continue;
		}

		const normalized = normalizeAnswerValue(answers[index], question.multiSelect);
		if (normalized !== undefined) {
			answerMap[question.question] = normalized;
		}
	}
	return answerMap;
}

function extractQuestionAnswersFromObject(
	questions: QuestionItem[],
	answers: Record<string, JsonValue>
): Record<string, string | string[]> {
	const answerMap: Record<string, string | string[]> = {};
	for (const question of questions) {
		const rawAnswer = answers[question.question];
		const normalized = normalizeAnswerValue(rawAnswer, question.multiSelect);
		if (normalized !== undefined) {
			answerMap[question.question] = normalized;
		}
	}
	return answerMap;
}

function normalizeAnswerValue(
	value: JsonValue | undefined,
	multiSelect: boolean
): string | string[] | undefined {
	if (typeof value === "string") {
		if (multiSelect) {
			return [value];
		}
		return value;
	}

	if (!Array.isArray(value)) {
		return undefined;
	}

	const answers: string[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			answers.push(item);
		}
	}

	if (answers.length === 0) {
		return undefined;
	}

	if (multiSelect || answers.length > 1) {
		return answers;
	}

	return answers[0];
}

function mapPlanApprovalStatus(
	state: InteractionSnapshot["state"]
): "pending" | "approved" | "rejected" | null {
	if (state === "Pending") {
		return "pending";
	}
	if (state === "Approved") {
		return "approved";
	}
	if (state === "Rejected") {
		return "rejected";
	}
	return null;
}

export function createInteractionStore(): InteractionStore {
	const store = new InteractionStore();
	setContext(INTERACTION_STORE_KEY, store);
	return store;
}

export function getInteractionStore(): InteractionStore {
	return getContext<InteractionStore>(INTERACTION_STORE_KEY);
}
