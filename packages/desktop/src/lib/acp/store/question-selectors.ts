import type { QuestionItem, QuestionRequest } from "../types/question.js";

/**
 * Find a pending question associated with a tool call.
 *
 * Matches by explicit tool call reference first, then by exact question ID.
 * Session-wide fallback matching is intentionally disallowed so one pending
 * interaction cannot attach itself to an unrelated tool row.
 */
export function findPendingQuestionForToolCall(
	pendingQuestions: Iterable<QuestionRequest>,
	toolCallId: string
): QuestionRequest | undefined {
	for (const pendingQuestion of pendingQuestions) {
		if (pendingQuestion.tool?.callID === toolCallId || pendingQuestion.id === toolCallId) {
			return pendingQuestion;
		}
	}
	return undefined;
}

/**
 * Resolve the question list for UI rendering.
 * Prefers normalized tool-call questions and falls back to pending question payload.
 */
export function resolveDisplayQuestions(
	normalizedQuestions: QuestionItem[] | null | undefined,
	pendingQuestion: QuestionRequest | undefined
): QuestionItem[] | null {
	if (normalizedQuestions && normalizedQuestions.length > 0) {
		return normalizedQuestions;
	}

	const pendingQuestions = pendingQuestion?.questions;
	if (pendingQuestions && pendingQuestions.length > 0) {
		return pendingQuestions;
	}

	return null;
}

/**
 * Returns the first question text for queue preview.
 */
export function getPrimaryQuestionText(pendingQuestion: QuestionRequest | null): string | null {
	const firstQuestion = pendingQuestion?.questions[0];
	return firstQuestion?.question ?? null;
}

/**
 * Group pending questions by session ID for queue derivation.
 */
export function groupPendingQuestionsBySession(
	pendingQuestions: Iterable<QuestionRequest>
): Map<string, QuestionRequest[]> {
	const grouped = new Map<string, QuestionRequest[]>();
	for (const pendingQuestion of pendingQuestions) {
		const existing = grouped.get(pendingQuestion.sessionId);
		if (existing) {
			existing.push(pendingQuestion);
			continue;
		}
		grouped.set(pendingQuestion.sessionId, [pendingQuestion]);
	}
	return grouped;
}
