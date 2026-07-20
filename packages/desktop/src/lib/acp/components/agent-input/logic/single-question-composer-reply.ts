import type { QuestionAnswer, QuestionRequest } from "../../../types/question.js";

export interface SingleQuestionComposerReply {
	readonly answers: QuestionAnswer[];
	readonly answerMap: Record<string, string | string[]>;
}

export function buildSingleQuestionComposerReply(
	questionRequest: QuestionRequest,
	content: string
): SingleQuestionComposerReply | null {
	if (questionRequest.questions.length !== 1) {
		return null;
	}

	const question = questionRequest.questions[0];
	if (question === undefined) {
		return null;
	}

	return {
		answers: [{ questionIndex: 0, answers: [content] }],
		answerMap: { [question.question]: content },
	};
}
