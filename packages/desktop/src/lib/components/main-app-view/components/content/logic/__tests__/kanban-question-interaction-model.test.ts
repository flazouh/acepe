import { describe, expect, it } from "bun:test";

import type { QuestionRequest } from "$lib/acp/types/question.js";

import {
	buildKanbanOptionSelectCommands,
	buildKanbanOtherInputCommands,
	buildKanbanOtherKeydownCommands,
	buildKanbanQuestionNavigationCommands,
	buildKanbanQuestionSubmitPayload,
} from "../kanban-question-interaction-model.js";

function makeQuestionRequest(
	questions: QuestionRequest["questions"],
	overrides: Partial<QuestionRequest> = {}
): QuestionRequest {
	return {
		id: "question-1",
		sessionId: "session-1",
		questions,
		...overrides,
	};
}

const singleSelectQuestion: QuestionRequest["questions"][number] = {
	question: "Pick one",
	header: "Choice",
	options: [{ label: "A", description: "Option A" }],
	multiSelect: false,
};

const multiSelectQuestion: QuestionRequest["questions"][number] = {
	question: "Pick many",
	header: "Choice",
	options: [{ label: "B", description: "Option B" }],
	multiSelect: true,
};

describe("kanban-question-interaction-model", () => {
	it("toggles options for multi-select questions", () => {
		const pendingQuestion = makeQuestionRequest([multiSelectQuestion], {
			tool: { messageID: null, callID: "tool-question" },
		});

		expect(
			buildKanbanOptionSelectCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 0,
				optionLabel: "B",
			})
		).toEqual([
			{
				kind: "toggle-option",
				questionId: "tool-question",
				questionIndex: 0,
				optionLabel: "B",
			},
		]);
	});

	it("sets a single option and submits when there is one question", () => {
		const pendingQuestion = makeQuestionRequest([singleSelectQuestion]);

		expect(
			buildKanbanOptionSelectCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 0,
				optionLabel: "A",
			})
		).toEqual([
			{
				kind: "set-single-option",
				questionId: "question-1",
				questionIndex: 0,
				optionLabel: "A",
			},
			{
				kind: "submit-question",
				sessionId: "session-1",
				defer: true,
			},
		]);
	});

	it("sets a single option and moves to the next question for multi-question forms", () => {
		const pendingQuestion = makeQuestionRequest([singleSelectQuestion, multiSelectQuestion]);

		expect(
			buildKanbanOptionSelectCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 0,
				optionLabel: "A",
			})
		).toEqual([
			{
				kind: "set-single-option",
				questionId: "question-1",
				questionIndex: 0,
				optionLabel: "A",
			},
			{
				kind: "set-current-question-index",
				sessionId: "session-1",
				questionId: "question-1",
				questionIndex: 1,
			},
		]);
	});

	it("activates other text and clears options for single-select questions", () => {
		const pendingQuestion = makeQuestionRequest([singleSelectQuestion]);

		expect(
			buildKanbanOtherInputCommands({
				pendingQuestion,
				currentQuestionIndex: 0,
				value: "custom",
				isOtherActive: false,
			})
		).toEqual([
			{
				kind: "set-other-text",
				questionId: "question-1",
				questionIndex: 0,
				value: "custom",
			},
			{
				kind: "set-other-active",
				questionId: "question-1",
				questionIndex: 0,
				active: true,
			},
			{
				kind: "clear-selections",
				questionId: "question-1",
				questionIndex: 0,
			},
		]);
	});

	it("deactivates other mode when text is cleared", () => {
		const pendingQuestion = makeQuestionRequest([multiSelectQuestion]);

		expect(
			buildKanbanOtherInputCommands({
				pendingQuestion,
				currentQuestionIndex: 0,
				value: "",
				isOtherActive: true,
			})
		).toEqual([
			{
				kind: "set-other-text",
				questionId: "question-1",
				questionIndex: 0,
				value: "",
			},
			{
				kind: "set-other-active",
				questionId: "question-1",
				questionIndex: 0,
				active: false,
			},
		]);
	});

	it("handles other-input enter and escape keys", () => {
		const pendingQuestion = makeQuestionRequest([singleSelectQuestion, multiSelectQuestion]);

		expect(
			buildKanbanOtherKeydownCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 0,
				key: "Enter",
				otherValue: "custom",
			})
		).toEqual([
			{
				kind: "set-current-question-index",
				sessionId: "session-1",
				questionId: "question-1",
				questionIndex: 1,
			},
		]);

		expect(
			buildKanbanOtherKeydownCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 1,
				key: "Enter",
				otherValue: "custom",
			})
		).toEqual([{ kind: "submit-question", sessionId: "session-1" }]);

		expect(
			buildKanbanOtherKeydownCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 1,
				key: "Escape",
				otherValue: "custom",
			})
		).toEqual([
			{
				kind: "set-other-active",
				questionId: "question-1",
				questionIndex: 1,
				active: false,
			},
		]);
	});

	it("builds prev and next navigation commands", () => {
		const pendingQuestion = makeQuestionRequest([singleSelectQuestion, multiSelectQuestion]);

		expect(
			buildKanbanQuestionNavigationCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 1,
				direction: "previous",
				totalQuestions: 2,
			})
		).toEqual([
			{
				kind: "set-current-question-index",
				sessionId: "session-1",
				questionId: "question-1",
				questionIndex: 0,
			},
		]);

		expect(
			buildKanbanQuestionNavigationCommands({
				sessionId: "session-1",
				pendingQuestion,
				currentQuestionIndex: 0,
				direction: "next",
				totalQuestions: 2,
			})
		).toEqual([
			{
				kind: "set-current-question-index",
				sessionId: "session-1",
				questionId: "question-1",
				questionIndex: 1,
			},
		]);
	});

	it("builds submit payload only when selections exist", () => {
		const pendingQuestion = makeQuestionRequest([singleSelectQuestion, multiSelectQuestion]);

		expect(
			buildKanbanQuestionSubmitPayload({
				pendingQuestion,
				hasAnySelections: false,
				getAnswers: () => [],
			})
		).toBe(null);

		expect(
			buildKanbanQuestionSubmitPayload({
				pendingQuestion,
				hasAnySelections: true,
				getAnswers: (index) => [`answer-${index}`],
			})
		).toEqual({
			questionId: "question-1",
			requestId: "question-1",
			questions: pendingQuestion.questions,
			answers: [
				{ questionIndex: 0, answers: ["answer-0"] },
				{ questionIndex: 1, answers: ["answer-1"] },
			],
		});
	});
});
