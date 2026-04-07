import { describe, expect, it } from "bun:test";

import type { QuestionItem, QuestionRequest } from "../../types/question.js";

import {
	findPendingQuestionForToolCall,
	getPrimaryQuestionText,
	groupPendingQuestionsBySession,
	resolveDisplayQuestions,
} from "../question-selectors.js";

const makeQuestion = (question: string): QuestionItem => ({
	question,
	header: "Question",
	options: [],
	multiSelect: false,
});

const makePendingQuestion = (
	id: string,
	sessionId: string,
	questions: QuestionItem[],
	toolCallId?: string
): QuestionRequest => ({
	id,
	sessionId,
	questions,
	tool: toolCallId ? { messageID: "m-1", callID: toolCallId } : undefined,
});

describe("question-selectors", () => {
	describe("findPendingQuestionForToolCall", () => {
		it("finds by tool call ID", () => {
			const pendingQuestions = [
				makePendingQuestion("q-1", "s-1", [makeQuestion("A")], "call-1"),
				makePendingQuestion("q-2", "s-1", [makeQuestion("B")], "call-2"),
			];

			expect(findPendingQuestionForToolCall(pendingQuestions, "call-2")?.id).toBe("q-2");
		});

		it("falls back to question ID matching", () => {
			const pendingQuestions = [makePendingQuestion("q-1", "s-1", [makeQuestion("A")])];

			expect(findPendingQuestionForToolCall(pendingQuestions, "q-1")?.id).toBe("q-1");
		});

		it("does not fall back to session-wide matching when tool linkage is absent", () => {
			const pendingQuestions = [makePendingQuestion("q-1", "s-1", [makeQuestion("A")])];

			expect(findPendingQuestionForToolCall(pendingQuestions, "unrelated-tool")).toBeUndefined();
		});
	});

	describe("resolveDisplayQuestions", () => {
		it("returns normalized questions when available", () => {
			const normalized = [makeQuestion("from normalized")];
			const pending = makePendingQuestion("q-1", "s-1", [makeQuestion("from pending")]);

			expect(resolveDisplayQuestions(normalized, pending)).toEqual(normalized);
		});

		it("falls back to pending questions when normalized questions are missing", () => {
			const pendingQuestions = [makeQuestion("from pending")];
			const pending = makePendingQuestion("q-1", "s-1", pendingQuestions);

			expect(resolveDisplayQuestions(null, pending)).toEqual(pendingQuestions);
		});

		it("returns null when neither source has questions", () => {
			expect(resolveDisplayQuestions(null, undefined)).toBeNull();
			expect(resolveDisplayQuestions([], makePendingQuestion("q-1", "s-1", []))).toBeNull();
		});
	});

	describe("getPrimaryQuestionText", () => {
		it("returns the first question text", () => {
			const pending = makePendingQuestion("q-1", "s-1", [
				makeQuestion("Pick one"),
				makeQuestion("Next"),
			]);

			expect(getPrimaryQuestionText(pending)).toBe("Pick one");
		});

		it("returns null when no question exists", () => {
			expect(getPrimaryQuestionText(null)).toBeNull();
			expect(getPrimaryQuestionText(makePendingQuestion("q-1", "s-1", []))).toBeNull();
		});
	});

	describe("groupPendingQuestionsBySession", () => {
		it("groups pending questions by session ID", () => {
			const pendingQuestions = [
				makePendingQuestion("q-1", "s-1", [makeQuestion("A")]),
				makePendingQuestion("q-2", "s-2", [makeQuestion("B")]),
				makePendingQuestion("q-3", "s-1", [makeQuestion("C")]),
			];

			const grouped = groupPendingQuestionsBySession(pendingQuestions);

			expect(grouped.get("s-1")?.map((q) => q.id)).toEqual(["q-1", "q-3"]);
			expect(grouped.get("s-2")?.map((q) => q.id)).toEqual(["q-2"]);
		});
	});
});
