import type { QuestionRequest } from "$lib/acp/types/question.js";

export interface QuestionSelectionReader {
	hasSelections(questionId: string, questionIndex: number): boolean;
	isOptionSelected(questionId: string, questionIndex: number, optionLabel: string): boolean;
	isOtherActive(questionId: string, questionIndex: number): boolean;
	getOtherText(questionId: string, questionIndex: number): string;
}

export interface QueueItemQuestionOption {
	readonly label: string;
	readonly selected: boolean;
	readonly color: string;
}

export interface QueueItemQuestionProgress {
	readonly questionIndex: number;
	readonly answered: boolean;
}

export interface QueueItemQuestionUiState {
	readonly totalQuestions: number;
	readonly hasMultipleQuestions: boolean;
	readonly currentQuestion: QuestionRequest["questions"][number] | null;
	readonly currentQuestionAnswered: boolean;
	readonly questionProgress: readonly QueueItemQuestionProgress[];
	readonly currentQuestionOptions: readonly QueueItemQuestionOption[];
	readonly isSingleQuestionSingleSelect: boolean;
	readonly hasOtherActive: boolean;
	readonly otherText: string;
	readonly canSubmit: boolean;
	readonly showSubmitButton: boolean;
}

export interface BuildQueueItemQuestionUiStateInput {
	readonly pendingQuestion: QuestionRequest | null;
	readonly questionId: string;
	readonly currentQuestionIndex: number;
	readonly questionColors: readonly string[];
	readonly selectionReader: QuestionSelectionReader;
}

export function buildQueueItemQuestionUiState(
	input: BuildQueueItemQuestionUiStateInput
): QueueItemQuestionUiState {
	const { pendingQuestion, questionId, currentQuestionIndex, questionColors, selectionReader } =
		input;

	const totalQuestions = pendingQuestion?.questions.length ?? 0;
	const hasMultipleQuestions = totalQuestions > 1;
	const currentQuestion = pendingQuestion?.questions[currentQuestionIndex] ?? null;

	const currentQuestionAnswered =
		questionId.length > 0 && selectionReader.hasSelections(questionId, currentQuestionIndex);

	const questionProgress = pendingQuestion
		? pendingQuestion.questions.map((_, questionIndex) => ({
				questionIndex,
				answered: questionId.length > 0 && selectionReader.hasSelections(questionId, questionIndex),
			}))
		: [];

	const currentQuestionOptions = currentQuestion
		? currentQuestion.options.map((option, index) => ({
				label: option.label,
				selected:
					questionId.length > 0 &&
					selectionReader.isOptionSelected(questionId, currentQuestionIndex, option.label),
				color: questionColors[index % questionColors.length],
			}))
		: [];

	const isSingleQuestionSingleSelect = totalQuestions === 1 && !currentQuestion?.multiSelect;

	const hasOtherActive = pendingQuestion
		? pendingQuestion.questions.some(
				(_, questionIndex) =>
					questionId.length > 0 && selectionReader.isOtherActive(questionId, questionIndex)
			)
		: false;

	const otherText =
		questionId.length > 0 ? selectionReader.getOtherText(questionId, currentQuestionIndex) : "";

	const canSubmit = pendingQuestion
		? pendingQuestion.questions.some(
				(_, questionIndex) =>
					questionId.length > 0 && selectionReader.hasSelections(questionId, questionIndex)
			)
		: false;

	const showSubmitButton =
		hasMultipleQuestions || Boolean(currentQuestion?.multiSelect) || hasOtherActive;

	return {
		totalQuestions,
		hasMultipleQuestions,
		currentQuestion,
		currentQuestionAnswered,
		questionProgress,
		currentQuestionOptions,
		isSingleQuestionSingleSelect,
		hasOtherActive,
		otherText,
		canSubmit,
		showSubmitButton,
	};
}
