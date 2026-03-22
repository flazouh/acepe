import type { QuestionItem, QuestionRequest } from "../types/question.js";

/**
 * Find a pending question associated with a tool call.
 *
 * Matches by tool call ID first, then falls back to session ID matching
 * for agents (e.g. OpenCode) where the question event has a different ID
 * than the tool invocation event.
 */
export function findPendingQuestionForToolCall(
	pendingQuestions: Iterable<QuestionRequest>,
	toolCallId: string,
	sessionId?: string
): QuestionRequest | undefined {
	for (const pendingQuestion of pendingQuestions) {
		if (pendingQuestion.tool?.callID === toolCallId || pendingQuestion.id === toolCallId) {
			return pendingQuestion;
		}
	}
	// Fallback: match by session ID when IDs differ between events
	if (sessionId) {
		for (const pendingQuestion of pendingQuestions) {
			if (pendingQuestion.sessionId === sessionId) {
				return pendingQuestion;
			}
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
