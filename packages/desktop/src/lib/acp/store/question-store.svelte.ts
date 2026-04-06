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
import type { QuestionItem, QuestionRequest } from "../types/question.js";

/**
 * Answered question data for display in the UI.
 * Stored when a user answers a question, enabling display after submission.
 */
export interface AnsweredQuestion {
	/** The questions that were asked */
	questions: QuestionItem[];
	/** Map of question text to answer(s) - value is string for single-select, array for multi-select */
	answers: Record<string, string | string[]>;
	/** Timestamp when the question was answered */
	answeredAt: number;
	/** Whether the question was cancelled (not answered) */
	cancelled?: boolean;
}

import { AgentError } from "../errors/app-error.js";
import { cancelQuestion, respondToQuestion } from "../logic/inbound-request-handler.js";
import { createLogger } from "../utils/logger.js";
import { api } from "./api.js";

const QUESTION_STORE_KEY = Symbol("question-store");
const logger = createLogger({ id: "question-store", name: "QuestionStore" });

export class QuestionStore {
	pending = new SvelteMap<string, QuestionRequest>();
	/**
	 * Map of tool call ID to answered question data.
	 * Used to display answered questions after submission.
	 */
	answered = new SvelteMap<string, AnsweredQuestion>();

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
		this.pending.set(question.id, question);
		logger.debug("Question request added", { questionId: question.id });
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
	 * For ACP mode (Claude Code's AskUserQuestion tool), uses JSON-RPC response.
	 * For OpenCode HTTP mode, uses the HTTP endpoint via api.replyQuestion.
	 *
	 * @param questionId - The question ID
	 * @param answers - Array of { questionIndex, answers: string[] } for OpenCode mode,
	 *                  or will be converted to Record<string, string | string[]> for ACP mode
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

		// If this question has a JSON-RPC request ID, use the JSON-RPC response mechanism (ACP mode)
		if (question.jsonRpcRequestId !== undefined) {
			return respondToQuestion(question.sessionId, question.jsonRpcRequestId, answerMap)
				.map(() => {
					logger.debug("Question replied via JSON-RPC", { questionId });
				})
				.mapErr((err) => new AgentError("replyQuestion", new Error(err.message)) as AppError);
		}

		// Otherwise, use the HTTP endpoint (OpenCode mode)
		return api.replyQuestion(question.sessionId, questionId, answers).map(() => {
			logger.debug("Question replied via HTTP", { questionId });
		});
	}

	/**
	 * Cancel a question request without answering.
	 *
	 * For ACP mode, sends a cancellation response via JSON-RPC.
	 * For OpenCode mode, just removes the question from the store.
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

		// If this question has a JSON-RPC request ID, send cancellation via JSON-RPC
		if (question.jsonRpcRequestId !== undefined) {
			return cancelQuestion(question.sessionId, question.jsonRpcRequestId)
				.map(() => {
					logger.debug("Question cancelled via JSON-RPC", { questionId });
				})
				.mapErr((err) => new AgentError("cancelQuestion", new Error(err.message)) as AppError);
		}

		// Stream-only ACP questions reuse the reply endpoint with an empty answer set.
		// This lets the backend resolve the synthetic question state and release the turn.
		return api.replyQuestion(question.sessionId, questionId, []).map(() => {
			logger.debug("Question cancelled via replyQuestion fallback", { questionId });
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
export function createQuestionStore(): QuestionStore {
	const store = new QuestionStore();
	setContext(QUESTION_STORE_KEY, store);
	return store;
}

/**
 * Get the question store from Svelte context.
 */
export function getQuestionStore(): QuestionStore {
	return getContext<QuestionStore>(QUESTION_STORE_KEY);
}
