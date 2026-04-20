/**
 * Question Store - Manages question requests from agents.
 *
 * This store handles pending question requests from ACP and OpenCode agents,
 * allowing users to answer questions during agent execution.
 *
 * For ACP mode (Claude Code's AskUserQuestion tool), questions come via
 * JSON-RPC inbound requests and responses are sent back via JSON-RPC.
 *
 * For OpenCode HTTP mode, questions come via session updates
 * and responses are sent via HTTP endpoints.
 */

import { errAsync, okAsync, ResultAsync, type ResultAsync as ResultAsyncType } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";
import { cancelQuestionRequest, replyToQuestionRequest } from "../logic/interaction-reply.js";
import type { Operation } from "../types/operation.js";
import type { AnsweredQuestion, QuestionItem, QuestionRequest } from "../types/question.js";
import { createLogger } from "../utils/logger.js";
import { InteractionStore } from "./interaction-store.svelte.js";
import { questionMatchesOperation } from "./operation-association.js";

const QUESTION_STORE_KEY = Symbol("question-store");
const logger = createLogger({ id: "question-store", name: "QuestionStore" });

function mergeQuestionRequest(
	existing: QuestionRequest,
	incoming: QuestionRequest
): QuestionRequest {
	const sessionId = incoming.sessionId.length > 0 ? incoming.sessionId : existing.sessionId;
	const replyHandler =
		incoming.replyHandler !== undefined ? incoming.replyHandler : existing.replyHandler;
	const jsonRpcRequestId =
		incoming.jsonRpcRequestId !== undefined ? incoming.jsonRpcRequestId : existing.jsonRpcRequestId;
	const questions = incoming.questions.length > 0 ? incoming.questions : existing.questions;
	const tool = incoming.tool !== undefined ? incoming.tool : existing.tool;

	return {
		id: incoming.id,
		sessionId,
		jsonRpcRequestId,
		replyHandler,
		questions,
		tool,
	};
}

export class QuestionStore {
	private interactions = new InteractionStore();

	constructor(interactions?: InteractionStore) {
		if (interactions !== undefined) {
			this.interactions = interactions;
		}
	}

	get pending(): SvelteMap<string, QuestionRequest> {
		return this.interactions.questionsPending;
	}

	get answered(): SvelteMap<string, AnsweredQuestion> {
		return this.interactions.answeredQuestions;
	}

	getForToolCall(sessionId: string, toolCallId: string): QuestionRequest | undefined {
		for (const question of this.pending.values()) {
			if (question.sessionId !== sessionId) {
				continue;
			}
			if (question.tool?.callID === toolCallId || question.id === toolCallId) {
				return question;
			}
		}

		return undefined;
	}

	getForOperation(operation: Operation): QuestionRequest | undefined {
		for (const question of this.pending.values()) {
			if (question.sessionId !== operation.sessionId) {
				continue;
			}

			if (!questionMatchesOperation(question, operation)) {
				continue;
			}

			return question;
		}

		return undefined;
	}

	/**
	 * Index mapping sessionId → first pending QuestionRequest for O(1) lookup.
	 *
	 * Computed once per change to `pending` instead of O(q) scan per panel.
	 * Only the first (oldest) question per session is stored; callers that need
	 * all questions for a session should iterate `pending` directly.
	 */
	readonly pendingBySession = $derived.by(() => {
		const map = new SvelteMap<string, QuestionRequest>();
		for (const question of this.pending.values()) {
			if (!map.has(question.sessionId)) {
				map.set(question.sessionId, question);
			}
		}
		return map;
	});

	/**
	 * Add a pending question request.
	 */
	add(question: QuestionRequest): void {
		const existing = this.pending.get(question.id);
		const nextQuestion = existing ? mergeQuestionRequest(existing, question) : question;
		this.pending.set(question.id, nextQuestion);
		logger.debug(existing ? "Question request merged" : "Question request added", {
			questionId: question.id,
			jsonRpcRequestId: nextQuestion.jsonRpcRequestId,
		});
	}

	/**
	 * Remove a pending question request.
	 */
	remove(questionId: string): void {
		this.pending.delete(questionId);
		logger.debug("Question request removed", { questionId });
	}

	/**
	 * Remove all questions for a session.
	 */
	removeForSession(sessionId: string): void {
		for (const [id, q] of this.pending) {
			if (q.sessionId === sessionId) this.pending.delete(id);
		}
		logger.debug("Questions removed for session", { sessionId });
	}

	/**
	 * Clear all answered questions (called when switching sessions).
	 */
	clearAnswered(): void {
		this.answered.clear();
		logger.debug("Cleared answered questions");
	}

	/**
	 * Get answered question by tool call ID.
	 */
	getAnswered(toolCallId: string): AnsweredQuestion | undefined {
		return this.answered.get(toolCallId);
	}

	/**
	 * Reply to a question request.
	 *
	 * The shared interaction reply layer resolves the correct transport.
	 *
	 * @param questionId - The question ID
	 * @param answers - Array of { questionIndex, answers: string[] }
	 * @param questions - The normalized questions from the tool call (from Rust parsing).
	 *                    Used as the source of truth for building answer map and storing answered questions.
	 */
	reply(
		questionId: string,
		answers: Array<{ questionIndex: number; answers: string[] }>,
		questions: QuestionItem[]
	): ResultAsync<void, AppError> {
		const question = this.pending.get(questionId);
		if (!question) {
			return errAsync(
				new AgentError("replyQuestion", new Error(`Question not found: ${questionId}`))
			);
		}

		// Build the answer map for display (used by both modes)
		const answerMap: Record<string, string | string[]> = {};
		for (const answer of answers) {
			const q = questions[answer.questionIndex];
			if (q) {
				const shouldStoreAsArray = q.multiSelect || answer.answers.length > 1;
				answerMap[q.question] = shouldStoreAsArray ? answer.answers : (answer.answers[0] ?? "");
			}
		}

		// Store the answered question for display (keyed by tool call ID if available)
		const toolCallId = question.tool?.callID ?? questionId;
		const answeredQuestion: AnsweredQuestion = {
			questions,
			answers: answerMap,
			answeredAt: Date.now(),
		};
		this.answered.set(toolCallId, answeredQuestion);
		logger.debug("Question answer stored for display", { questionId, toolCallId });

		// Eagerly remove from pending map so the UI updates immediately.
		// The user's intent is clear — don't wait for the async IPC response.
		this.remove(questionId);

		return replyToQuestionRequest(question, answers, answerMap).map(() => {
			logger.debug("Question reply sent", { questionId });
		});
	}

	/**
	 * Cancel a question request without answering.
	 *
	 * The shared interaction reply layer resolves the correct transport.
	 */
	cancel(questionId: string): ResultAsync<void, AppError> {
		const question = this.pending.get(questionId);
		if (!question) {
			return errAsync(
				new AgentError("cancelQuestion", new Error(`Question not found: ${questionId}`))
			);
		}

		// Store the cancelled question for display (keyed by tool call ID if available)
		const toolCallId = question.tool?.callID ?? questionId;
		const cancelledQuestion: AnsweredQuestion = {
			questions: question.questions,
			answers: {},
			answeredAt: Date.now(),
			cancelled: true,
		};
		this.answered.set(toolCallId, cancelledQuestion);
		logger.debug("Question cancellation stored for display", { questionId, toolCallId });

		// Eagerly remove from pending map so the UI updates immediately.
		this.remove(questionId);

		return cancelQuestionRequest(question).map(() => {
			logger.debug("Question cancel sent", { questionId });
		});
	}

	cancelForSession(sessionId: string): ResultAsyncType<void, AppError> {
		const pendingQuestions: QuestionRequest[] = [];
		for (const question of this.pending.values()) {
			if (question.sessionId === sessionId) {
				pendingQuestions.push(question);
			}
		}

		if (pendingQuestions.length === 0) {
			return okAsync(undefined);
		}

		return ResultAsync.combine(
			pendingQuestions.map((question) => {
				if (!this.pending.has(question.id)) {
					return okAsync(undefined);
				}

				logger.info("Cancelling pending question for interrupted turn", {
					questionId: question.id,
					sessionId: question.sessionId,
				});
				return this.cancel(question.id);
			})
		).map(() => undefined);
	}
}

/**
 * Create and set the question store in Svelte context.
 */
export function createQuestionStore(interactions?: InteractionStore): QuestionStore {
	const store = new QuestionStore(interactions);
	setContext(QUESTION_STORE_KEY, store);
	return store;
}

/**
 * Get the question store from Svelte context.
 */
export function getQuestionStore(): QuestionStore {
	return getContext<QuestionStore>(QUESTION_STORE_KEY);
}
