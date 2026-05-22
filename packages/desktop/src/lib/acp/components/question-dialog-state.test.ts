import { describe, expect, it } from "bun:test";
import {
	buildQuestionAnswers,
	isQuestionAnswerSelected,
	toggleQuestionAnswer,
	type QuestionSelectionState,
} from "./question-dialog-state.js";
import type { QuestionRequest } from "../types/question.js";

function makeQuestions(): QuestionRequest["questions"] {
	return [
		{
			question: "Pick one",
			header: "One",
			options: [
				{ label: "A", description: "" },
				{ label: "B", description: "" },
			],
			multiSelect: false,
		},
		{
			question: "Pick many",
			header: "Many",
			options: [
				{ label: "C", description: "" },
				{ label: "D", description: "" },
			],
			multiSelect: true,
		},
	];
}

describe("question dialog state", () => {
	it("selects one answer for a single-choice question", () => {
		let state: QuestionSelectionState = new Map();
		state = toggleQuestionAnswer(state, 0, "A", false);
		state = toggleQuestionAnswer(state, 0, "B", false);

		expect(isQuestionAnswerSelected(state, 0, "A")).toBe(false);
		expect(isQuestionAnswerSelected(state, 0, "B")).toBe(true);
		expect(Array.from(state.get(0) ?? [])).toEqual(["B"]);
	});

	it("keeps a single-choice answer selected when clicked again", () => {
		let state: QuestionSelectionState = new Map();
		state = toggleQuestionAnswer(state, 0, "A", false);
		state = toggleQuestionAnswer(state, 0, "A", false);

		expect(isQuestionAnswerSelected(state, 0, "A")).toBe(true);
		expect(Array.from(state.get(0) ?? [])).toEqual(["A"]);
	});

	it("keeps multiple answers for a multi-choice question", () => {
		let state: QuestionSelectionState = new Map();
		state = toggleQuestionAnswer(state, 1, "C", true);
		state = toggleQuestionAnswer(state, 1, "D", true);

		expect(isQuestionAnswerSelected(state, 1, "C")).toBe(true);
		expect(isQuestionAnswerSelected(state, 1, "D")).toBe(true);
		expect(Array.from(state.get(1) ?? [])).toEqual(["C", "D"]);
	});

	it("builds submit answers for every question", () => {
		let state: QuestionSelectionState = new Map();
		state = toggleQuestionAnswer(state, 0, "A", false);
		state = toggleQuestionAnswer(state, 1, "C", true);
		state = toggleQuestionAnswer(state, 1, "D", true);

		expect(buildQuestionAnswers(makeQuestions(), state)).toEqual([
			{ questionIndex: 0, answers: ["A"] },
			{ questionIndex: 1, answers: ["C", "D"] },
		]);
	});

	it("includes empty answer arrays for unanswered questions", () => {
		expect(buildQuestionAnswers(makeQuestions(), new Map())).toEqual([
			{ questionIndex: 0, answers: [] },
			{ questionIndex: 1, answers: [] },
		]);
	});
});
