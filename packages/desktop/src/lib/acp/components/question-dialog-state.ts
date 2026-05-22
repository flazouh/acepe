import type { QuestionAnswer, QuestionRequest } from "../types/question.js";

export type QuestionSelectionState = ReadonlyMap<number, ReadonlySet<string>>;

export function toggleQuestionAnswer(
	selectedAnswers: QuestionSelectionState,
	questionIndex: number,
	label: string,
	multiple: boolean
): Map<number, Set<string>> {
	const nextSelectedAnswers = new Map<number, Set<string>>();

	for (const [index, answers] of selectedAnswers.entries()) {
		nextSelectedAnswers.set(index, new Set(answers));
	}

	const currentAnswers = nextSelectedAnswers.get(questionIndex) ?? new Set<string>();
	const nextAnswers = multiple ? new Set(currentAnswers) : new Set<string>();

	if (nextAnswers.has(label)) {
		nextAnswers.delete(label);
	} else {
		nextAnswers.add(label);
	}

	nextSelectedAnswers.set(questionIndex, nextAnswers);
	return nextSelectedAnswers;
}

export function isQuestionAnswerSelected(
	selectedAnswers: QuestionSelectionState,
	questionIndex: number,
	label: string
): boolean {
	return selectedAnswers.get(questionIndex)?.has(label) ?? false;
}

export function buildQuestionAnswers(
	questions: QuestionRequest["questions"],
	selectedAnswers: QuestionSelectionState
): QuestionAnswer[] {
	return questions.map((_question, index) => ({
		questionIndex: index,
		answers: Array.from(selectedAnswers.get(index) ?? []),
	}));
}
