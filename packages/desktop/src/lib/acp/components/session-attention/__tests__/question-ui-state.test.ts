import { describe, expect, it } from "bun:test";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import { buildQueueItemQuestionUiState } from "../question-ui-state.js";

const COLORS = ["#1", "#2", "#3", "#4"];

interface SelectionSnapshot {
	readonly selected: ReadonlyMap<number, readonly string[]>;
	readonly otherActive: ReadonlySet<number>;
	readonly otherText: ReadonlyMap<number, string>;
}

function createSelectionReader(snapshot: SelectionSnapshot) {
	return {
		hasSelections(questionId: string, questionIndex: number): boolean {
			void questionId;
			const labels = snapshot.selected.get(questionIndex) ?? [];
			const other = snapshot.otherText.get(questionIndex)?.trim() ?? "";
			return labels.length > 0 || other.length > 0;
		},
		isOptionSelected(questionId: string, questionIndex: number, optionLabel: string): boolean {
			void questionId;
			const labels = snapshot.selected.get(questionIndex) ?? [];
			return labels.includes(optionLabel);
		},
		isOtherActive(questionId: string, questionIndex: number): boolean {
			void questionId;
			return snapshot.otherActive.has(questionIndex);
		},
		getOtherText(questionId: string, questionIndex: number): string {
			void questionId;
			return snapshot.otherText.get(questionIndex) ?? "";
		},
	};
}

const pendingQuestion: QuestionRequest = {
	id: "q-1",
	sessionId: "s-1",
	questions: [
		{
			header: "H1",
			question: "Choose one",
			multiSelect: false,
			options: [
				{ label: "A", description: "desc" },
				{ label: "B", description: "desc" },
			],
		},
		{
			header: "H2",
			question: "Choose many",
			multiSelect: true,
			options: [
				{ label: "X", description: "desc" },
				{ label: "Y", description: "desc" },
			],
		},
	],
};

describe("buildQueueItemQuestionUiState", () => {
	it("builds option selection and progress dots", () => {
		const state = buildQueueItemQuestionUiState({
			pendingQuestion,
			questionId: "q-1",
			currentQuestionIndex: 0,
			questionColors: COLORS,
			selectionReader: createSelectionReader({
				selected: new Map([
					[0, ["A"]],
					[1, ["Y"]],
				]),
				otherActive: new Set<number>(),
				otherText: new Map<number, string>(),
			}),
		});

		expect(state.totalQuestions).toBe(2);
		expect(state.hasMultipleQuestions).toBe(true);
		expect(state.currentQuestion?.question).toBe("Choose one");
		expect(state.currentQuestionAnswered).toBe(true);
		expect(state.questionProgress).toEqual([
			{ questionIndex: 0, answered: true },
			{ questionIndex: 1, answered: true },
		]);
		expect(state.currentQuestionOptions).toEqual([
			{ label: "A", description: "desc", selected: true, color: "#1" },
			{ label: "B", description: "desc", selected: false, color: "#2" },
		]);
		expect(state.canSubmit).toBe(true);
		expect(state.showSubmitButton).toBe(true);
	});

	it('shows submit button for single-question single-select when "Other" is active', () => {
		const singleQuestion: QuestionRequest = {
			...pendingQuestion,
			questions: [pendingQuestion.questions[0]],
		};

		const state = buildQueueItemQuestionUiState({
			pendingQuestion: singleQuestion,
			questionId: "q-1",
			currentQuestionIndex: 0,
			questionColors: COLORS,
			selectionReader: createSelectionReader({
				selected: new Map<number, readonly string[]>(),
				otherActive: new Set([0]),
				otherText: new Map([[0, "custom"]]),
			}),
		});

		expect(state.hasOtherActive).toBe(true);
		expect(state.isSingleQuestionSingleSelect).toBe(true);
		expect(state.showSubmitButton).toBe(true);
		expect(state.otherText).toBe("custom");
	});

	it("keeps the freeform input visible for single-select questions", () => {
		const QUESTION_COLORS = ["#7c3aed", "#22c55e", "#f97316", "#ec4899"];

		const selectionReader = {
			hasSelections() {
				return false;
			},
			isOptionSelected() {
				return false;
			},
			isOtherActive() {
				return false;
			},
			getOtherText() {
				return "";
			},
		};

		const singleSelectQuestion: QuestionRequest = {
			id: "question-1",
			sessionId: "session-1",
			questions: [
				{
					header: "Project type",
					question: "What kind of project are you currently working on?",
					multiSelect: false,
					options: [
						{
							label: "Web app",
							description: "A frontend or full-stack web application.",
						},
					],
				},
			],
		};

		const state = buildQueueItemQuestionUiState({
			pendingQuestion: singleSelectQuestion,
			questionId: "tool-call-1",
			currentQuestionIndex: 0,
			questionColors: QUESTION_COLORS,
			selectionReader,
		});

		expect(state.showOtherInput).toBe(true);
	});
});
