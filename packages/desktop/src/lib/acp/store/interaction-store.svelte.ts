import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type {
	InteractionResponse,
	InteractionSnapshot,
	JsonValue,
	PermissionData,
	QuestionData,
	QuestionItem,
	SessionStateGraph,
	ToolReference,
} from "../../services/acp-types.js";
import type { PlanApprovalInteraction } from "../types/interaction.js";
import {
	buildPermissionGroupKey,
	createPermissionRequest,
	mergePermissionRequests,
	type PermissionRequest,
} from "../types/permission.js";
import type { AnsweredQuestion, QuestionRequest } from "../types/question.js";
import {
	createLegacyInteractionReplyHandler,
	normalizeInteractionReplyHandler,
} from "../types/reply-handler.js";

const INTERACTION_STORE_KEY = Symbol("interaction-store");

export class InteractionStore {
	readonly permissionsPending = new SvelteMap<string, PermissionRequest>();
	readonly questionsPending = new SvelteMap<string, QuestionRequest>();
	readonly answeredQuestions = new SvelteMap<string, AnsweredQuestion>();
	readonly planApprovalsPending = new SvelteMap<string, PlanApprovalInteraction>();
	private readonly answeredQuestionSessionIds = new SvelteMap<string, string>();
	private readonly pendingPermissionsBySession = new Map<
		string,
		Map<string, PermissionRequest>
	>();
	private readonly pendingQuestionsBySession = new Map<string, Map<string, QuestionRequest>>();
	private readonly pendingPlanApprovalsBySession = new Map<
		string,
		Map<string, PlanApprovalInteraction>
	>();

	setPlanApprovalStatus(interactionId: string, status: PlanApprovalInteraction["status"]): void {
		const approval = this.planApprovalsPending.get(interactionId);
		if (approval === undefined) {
			return;
		}

		this.setPendingPlanApproval(interactionId, {
			id: approval.id,
			kind: approval.kind,
			source: approval.source,
			sessionId: approval.sessionId,
			tool: {
				messageID: approval.tool.messageID,
				callID: approval.tool.callID,
			},
			jsonRpcRequestId: approval.jsonRpcRequestId,
			replyHandler: approval.replyHandler,
			status,
		});
	}

	getPendingQuestionsForSession(sessionId: string): readonly QuestionRequest[] {
		const indexed = this.pendingQuestionsBySession.get(sessionId);
		if (indexed !== undefined) {
			return Array.from(indexed.values());
		}

		return Array.from(this.questionsPending.values()).filter(
			(question) => question.sessionId === sessionId
		);
	}

	getPendingPermissionsForSession(sessionId: string): readonly PermissionRequest[] {
		const indexed = this.pendingPermissionsBySession.get(sessionId);
		if (indexed !== undefined) {
			return Array.from(indexed.values());
		}

		return Array.from(this.permissionsPending.values()).filter(
			(permission) => permission.sessionId === sessionId
		);
	}

	getPendingPlanApprovalsForSession(sessionId: string): readonly PlanApprovalInteraction[] {
		const indexed = this.pendingPlanApprovalsBySession.get(sessionId);
		if (indexed !== undefined) {
			return Array.from(indexed.values());
		}

		return Array.from(this.planApprovalsPending.values()).filter(
			(approval) => approval.sessionId === sessionId
		);
	}

	clearSession(sessionId: string): void {
		for (const [interactionId, permission] of this.permissionsPending) {
			if (permission.sessionId === sessionId) {
				this.deletePendingPermission(interactionId);
			}
		}

		for (const [interactionId, question] of this.questionsPending) {
			if (question.sessionId === sessionId) {
				this.deletePendingQuestion(interactionId);
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
				this.deletePendingPlanApproval(interactionId);
			}
		}
	}

	replaceSessionStateGraph(graph: SessionStateGraph): void {
		this.clearSession(graph.canonicalSessionId);
		for (const interaction of graph.interactions) {
			this.applyProjectionInteraction(interaction);
		}
	}

	applySessionInteractionPatches(snapshots: ReadonlyArray<InteractionSnapshot>): void {
		for (const interaction of snapshots) {
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
			this.deletePendingPermission(interaction.id);
			return;
		}
		this.upsertPendingPermission(
			createPermissionRequest({
				id: payload.id,
				sessionId: payload.sessionId,
				jsonRpcRequestId: payload.jsonRpcRequestId,
				replyHandler:
					normalizeInteractionReplyHandler(interaction.reply_handler) ??
					normalizeInteractionReplyHandler(payload.replyHandler) ??
					createLegacyInteractionReplyHandler(payload.id, payload.jsonRpcRequestId),
				permission: payload.permission,
				patterns: payload.patterns,
				metadata: payload.metadata,
				always: payload.always,
				tool: payload.tool,
			})
		);
	}

	private upsertPendingPermission(permission: PermissionRequest): void {
		const groupKey = buildPermissionGroupKey(permission);
		for (const [interactionId, existingPermission] of this.permissionsPending) {
			if (buildPermissionGroupKey(existingPermission) !== groupKey) {
				continue;
			}

			this.setPendingPermission(
				interactionId,
				mergePermissionRequests(existingPermission, permission)
			);
			return;
		}

		this.setPendingPermission(permission.id, permission);
	}

	private applyQuestionInteraction(interaction: InteractionSnapshot, payload: QuestionData): void {
		const request = this.buildQuestionRequest(interaction, payload);
		if (interaction.state === "Pending") {
			this.setPendingQuestion(request.id, request);
			return;
		}

		if (interaction.state !== "Answered" && interaction.state !== "Rejected") {
			return;
		}

		this.deletePendingQuestion(request.id);
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
		const replyHandler =
			normalizeInteractionReplyHandler(interaction.reply_handler) ??
			createLegacyInteractionReplyHandler(interaction.id, jsonRpcRequestId);
		const status = mapPlanApprovalStatus(interaction.state);
		if (tool === undefined || status === null) {
			this.deletePendingPlanApproval(interaction.id);
			return;
		}

		if (status !== "pending") {
			this.deletePendingPlanApproval(interaction.id);
			return;
		}

		this.setPendingPlanApproval(interaction.id, {
			id: interaction.id,
			kind: "plan_approval",
			source: source === "CreatePlan" ? "create_plan" : "exit_plan_mode",
			sessionId: interaction.session_id,
			tool,
			jsonRpcRequestId: jsonRpcRequestId ?? undefined,
			replyHandler,
			status,
		});
	}

	private setPendingPermission(interactionId: string, permission: PermissionRequest): void {
		this.deletePendingPermission(interactionId);
		this.permissionsPending.set(interactionId, permission);
		getOrCreateSessionIndex(this.pendingPermissionsBySession, permission.sessionId).set(
			interactionId,
			permission
		);
	}

	private deletePendingPermission(interactionId: string): void {
		const existing = this.permissionsPending.get(interactionId);
		if (existing === undefined) {
			return;
		}
		this.permissionsPending.delete(interactionId);
		deleteSessionIndexEntry(
			this.pendingPermissionsBySession,
			existing.sessionId,
			interactionId
		);
	}

	private setPendingQuestion(interactionId: string, question: QuestionRequest): void {
		this.deletePendingQuestion(interactionId);
		this.questionsPending.set(interactionId, question);
		getOrCreateSessionIndex(this.pendingQuestionsBySession, question.sessionId).set(
			interactionId,
			question
		);
	}

	private deletePendingQuestion(interactionId: string): void {
		const existing = this.questionsPending.get(interactionId);
		if (existing === undefined) {
			return;
		}
		this.questionsPending.delete(interactionId);
		deleteSessionIndexEntry(this.pendingQuestionsBySession, existing.sessionId, interactionId);
	}

	private setPendingPlanApproval(
		interactionId: string,
		approval: PlanApprovalInteraction
	): void {
		this.deletePendingPlanApproval(interactionId);
		this.planApprovalsPending.set(interactionId, approval);
		getOrCreateSessionIndex(this.pendingPlanApprovalsBySession, approval.sessionId).set(
			interactionId,
			approval
		);
	}

	private deletePendingPlanApproval(interactionId: string): void {
		const existing = this.planApprovalsPending.get(interactionId);
		if (existing === undefined) {
			return;
		}
		this.planApprovalsPending.delete(interactionId);
		deleteSessionIndexEntry(
			this.pendingPlanApprovalsBySession,
			existing.sessionId,
			interactionId
		);
	}

	private buildQuestionRequest(
		interaction: InteractionSnapshot,
		payload: QuestionData
	): QuestionRequest {
		return {
			id: payload.id,
			sessionId: payload.sessionId,
			jsonRpcRequestId: payload.jsonRpcRequestId ?? undefined,
			replyHandler:
				normalizeInteractionReplyHandler(interaction.reply_handler) ??
				normalizeInteractionReplyHandler(payload.replyHandler) ??
				createLegacyInteractionReplyHandler(payload.id, payload.jsonRpcRequestId),
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
): { messageID: string | null; callID: string } | undefined {
	if (tool === undefined || tool === null) {
		return undefined;
	}

	return {
		messageID: tool.messageId ?? null,
		callID: tool.callId,
	};
}

function getOrCreateSessionIndex<T>(
	index: Map<string, Map<string, T>>,
	sessionId: string
): Map<string, T> {
	const existing = index.get(sessionId);
	if (existing !== undefined) {
		return existing;
	}

	const created = new Map<string, T>();
	index.set(sessionId, created);
	return created;
}

function deleteSessionIndexEntry<T>(
	index: Map<string, Map<string, T>>,
	sessionId: string,
	entryId: string
): void {
	const sessionIndex = index.get(sessionId);
	if (sessionIndex === undefined) {
		return;
	}

	sessionIndex.delete(entryId);
	if (sessionIndex.size === 0) {
		index.delete(sessionId);
	}
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
