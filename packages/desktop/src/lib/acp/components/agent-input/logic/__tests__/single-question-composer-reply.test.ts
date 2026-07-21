import { describe, expect, it } from "vitest";
import type { QuestionRequest } from "../../../../types/question.js";
import { buildSingleQuestionComposerReply } from "../single-question-composer-reply.js";

function makeQuestion(questions: QuestionRequest["questions"]): QuestionRequest {
	return {
		id: "question-1",
		sessionId: "session-1",
		questions,
	};
}

describe("buildSingleQuestionComposerReply", () => {
	it("uses composer text as the answer to one pending question", () => {
		const reply = buildSingleQuestionComposerReply(
			makeQuestion([
				{
					question: "Which changes should be reverted?",
					header: "Scope",
					options: [],
					multiSelect: false,
				},
			]),
			"Revert the second set."
		);

		expect(reply).toEqual({
			answers: [{ questionIndex: 0, answers: ["Revert the second set."] }],
			answerMap: { "Which changes should be reverted?": "Revert the second set." },
		});
	});

	it("does not guess how free text maps to multiple questions", () => {
		const reply = buildSingleQuestionComposerReply(
			makeQuestion([
				{
					question: "First choice",
					header: "First",
					options: [],
					multiSelect: false,
				},
				{
					question: "Second choice",
					header: "Second",
					options: [],
					multiSelect: false,
				},
			]),
			"An answer"
		);

		expect(reply).toBeNull();
	});
});
