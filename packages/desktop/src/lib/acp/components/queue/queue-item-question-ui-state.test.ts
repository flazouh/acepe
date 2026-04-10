import { describe, expect, it } from "bun:test";

import type { QuestionRequest } from "$lib/acp/types/question.js";

import {
	buildQueueItemQuestionUiState,
	type QuestionSelectionReader,
} from "./queue-item-question-ui-state.js";

const QUESTION_COLORS = ["#7c3aed", "#22c55e", "#f97316", "#ec4899"];

const selectionReader: QuestionSelectionReader = {
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

function createPendingQuestion(): QuestionRequest {
	return {
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
}

describe("buildQueueItemQuestionUiState", () => {
	it("keeps the freeform input visible for single-select questions", () => {
		const state = buildQueueItemQuestionUiState({
			pendingQuestion: createPendingQuestion(),
			questionId: "tool-call-1",
			currentQuestionIndex: 0,
			questionColors: QUESTION_COLORS,
			selectionReader,
		});

		expect(state.showOtherInput).toBe(true);
	});
});
