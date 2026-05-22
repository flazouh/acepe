import type { QuestionRequest } from "$lib/acp/types/question.js";

import { resolveKanbanQuestionId } from "./kanban-footer-model.js";

export type KanbanQuestionInteractionCommand =
	| {
			readonly kind: "toggle-option";
			readonly questionId: string;
			readonly questionIndex: number;
			readonly optionLabel: string;
	  }
	| {
			readonly kind: "set-single-option";
			readonly questionId: string;
			readonly questionIndex: number;
			readonly optionLabel: string;
	  }
	| {
			readonly kind: "set-current-question-index";
			readonly sessionId: string;
			readonly questionId: string;
			readonly questionIndex: number;
	  }
	| {
			readonly kind: "submit-question";
			readonly sessionId: string;
			readonly defer?: boolean;
	  }
	| {
			readonly kind: "set-other-text";
			readonly questionId: string;
			readonly questionIndex: number;
			readonly value: string;
	  }
	| {
			readonly kind: "set-other-active";
			readonly questionId: string;
			readonly questionIndex: number;
			readonly active: boolean;
	  }
	| {
			readonly kind: "clear-selections";
			readonly questionId: string;
			readonly questionIndex: number;
	  };

export function buildKanbanOptionSelectCommands(input: {
	readonly sessionId: string;
	readonly pendingQuestion: QuestionRequest | null;
	readonly currentQuestionIndex: number;
	readonly optionLabel: string;
}): readonly KanbanQuestionInteractionCommand[] {
	const pendingQuestion = input.pendingQuestion;
	const currentQuestion = pendingQuestion?.questions[input.currentQuestionIndex] ?? null;
	if (!pendingQuestion || !currentQuestion) {
		return [];
	}

	const questionId = resolveKanbanQuestionId(pendingQuestion);
	if (currentQuestion.multiSelect) {
		return [
			{
				kind: "toggle-option",
				questionId,
				questionIndex: input.currentQuestionIndex,
				optionLabel: input.optionLabel,
			},
		];
	}

	const commands: KanbanQuestionInteractionCommand[] = [
		{
			kind: "set-single-option",
			questionId,
			questionIndex: input.currentQuestionIndex,
			optionLabel: input.optionLabel,
		},
	];

	if (pendingQuestion.questions.length === 1) {
		commands.push({ kind: "submit-question", sessionId: input.sessionId, defer: true });
		return commands;
	}

	if (input.currentQuestionIndex < pendingQuestion.questions.length - 1) {
		commands.push({
			kind: "set-current-question-index",
			sessionId: input.sessionId,
			questionId,
			questionIndex: input.currentQuestionIndex + 1,
		});
	}

	return commands;
}

export function buildKanbanOtherInputCommands(input: {
	readonly pendingQuestion: QuestionRequest | null;
	readonly currentQuestionIndex: number;
	readonly value: string;
	readonly isOtherActive: boolean;
}): readonly KanbanQuestionInteractionCommand[] {
	const pendingQuestion = input.pendingQuestion;
	const currentQuestion = pendingQuestion?.questions[input.currentQuestionIndex] ?? null;
	if (!pendingQuestion || !currentQuestion) {
		return [];
	}

	const questionId = resolveKanbanQuestionId(pendingQuestion);
	const commands: KanbanQuestionInteractionCommand[] = [
		{
			kind: "set-other-text",
			questionId,
			questionIndex: input.currentQuestionIndex,
			value: input.value,
		},
	];
	const hasText = input.value.trim().length > 0;

	if (hasText && !input.isOtherActive) {
		commands.push({
			kind: "set-other-active",
			questionId,
			questionIndex: input.currentQuestionIndex,
			active: true,
		});
		if (!currentQuestion.multiSelect) {
			commands.push({
				kind: "clear-selections",
				questionId,
				questionIndex: input.currentQuestionIndex,
			});
		}
	}

	if (!hasText && input.isOtherActive) {
		commands.push({
			kind: "set-other-active",
			questionId,
			questionIndex: input.currentQuestionIndex,
			active: false,
		});
	}

	return commands;
}

export function buildKanbanOtherKeydownCommands(input: {
	readonly sessionId: string;
	readonly pendingQuestion: QuestionRequest | null;
	readonly currentQuestionIndex: number;
	readonly key: string;
	readonly otherValue: string;
}): readonly KanbanQuestionInteractionCommand[] {
	const pendingQuestion = input.pendingQuestion;
	if (!pendingQuestion) {
		return [];
	}

	const questionId = resolveKanbanQuestionId(pendingQuestion);
	const trimmedOtherValue = input.otherValue.trim();

	if (input.key === "Escape") {
		return [
			{
				kind: "set-other-active",
				questionId,
				questionIndex: input.currentQuestionIndex,
				active: false,
			},
		];
	}

	if (input.key !== "Enter" || trimmedOtherValue.length === 0) {
		return [];
	}

	if (pendingQuestion.questions.length === 1) {
		return [{ kind: "submit-question", sessionId: input.sessionId }];
	}

	if (input.currentQuestionIndex < pendingQuestion.questions.length - 1) {
		return [
			{
				kind: "set-current-question-index",
				sessionId: input.sessionId,
				questionId,
				questionIndex: input.currentQuestionIndex + 1,
			},
		];
	}

	return [{ kind: "submit-question", sessionId: input.sessionId }];
}

export function buildKanbanQuestionNavigationCommands(input: {
	readonly sessionId: string;
	readonly pendingQuestion: QuestionRequest | null;
	readonly currentQuestionIndex: number;
	readonly direction: "previous" | "next";
	readonly totalQuestions: number;
}): readonly KanbanQuestionInteractionCommand[] {
	const pendingQuestion = input.pendingQuestion;
	if (!pendingQuestion) {
		return [];
	}

	const questionId = resolveKanbanQuestionId(pendingQuestion);
	if (input.direction === "previous" && input.currentQuestionIndex > 0) {
		return [
			{
				kind: "set-current-question-index",
				sessionId: input.sessionId,
				questionId,
				questionIndex: input.currentQuestionIndex - 1,
			},
		];
	}

	if (input.direction === "next" && input.currentQuestionIndex < input.totalQuestions - 1) {
		return [
			{
				kind: "set-current-question-index",
				sessionId: input.sessionId,
				questionId,
				questionIndex: input.currentQuestionIndex + 1,
			},
		];
	}

	return [];
}

export function buildKanbanQuestionSubmitPayload(input: {
	readonly pendingQuestion: QuestionRequest | null;
	readonly hasAnySelections: boolean;
	readonly getAnswers: (questionIndex: number, multiSelect: boolean) => string[];
}): {
	readonly questionId: string;
	readonly requestId: string;
	readonly questions: QuestionRequest["questions"];
	readonly answers: { questionIndex: number; answers: string[] }[];
} | null {
	const pendingQuestion = input.pendingQuestion;
	if (!pendingQuestion) {
		return null;
	}

	const questionId = resolveKanbanQuestionId(pendingQuestion);
	if (!input.hasAnySelections) {
		return null;
	}

	return {
		questionId,
		requestId: pendingQuestion.id,
		questions: pendingQuestion.questions,
		answers: pendingQuestion.questions.map((question, questionIndex) => ({
			questionIndex,
			answers: input.getAnswers(questionIndex, question.multiSelect),
		})),
	};
}
