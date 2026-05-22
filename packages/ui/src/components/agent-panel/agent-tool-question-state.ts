import type { AgentQuestion } from "./types.js";

export function isSingleQuestionSingleSelect(
	questions: readonly AgentQuestion[] | null | undefined
): boolean {
	if (!questions?.[0]) {
		return false;
	}
	return questions.length === 1 && !questions[0].multiSelect;
}

export function hasActiveOtherText(otherText: Readonly<Record<number, string>>): boolean {
	for (const text of Object.values(otherText)) {
		if (text.trim().length > 0) {
			return true;
		}
	}
	return false;
}

export function shouldShowQuestionFooter(input: {
	readonly isInteractive: boolean;
	readonly questions: readonly AgentQuestion[] | null | undefined;
	readonly otherText: Readonly<Record<number, string>>;
}): boolean {
	return (
		input.isInteractive &&
		Boolean(input.questions) &&
		(!isSingleQuestionSingleSelect(input.questions) || hasActiveOtherText(input.otherText))
	);
}

export function isQuestionOptionSelected(input: {
	readonly selectedLabels: Readonly<Record<number, readonly string[]>>;
	readonly questionIndex: number;
	readonly label: string;
}): boolean {
	return input.selectedLabels[input.questionIndex]?.includes(input.label) ?? false;
}

export function formatQuestionAnswerLabels(input: {
	readonly answeredLabels: Readonly<Record<number, readonly string[]>>;
	readonly questionIndex: number;
	readonly noAnswerLabel: string;
}): string {
	const labels = input.answeredLabels[input.questionIndex];
	if (!labels || labels.length === 0) {
		return input.noAnswerLabel;
	}
	return labels.join(", ");
}

export function shouldStopQuestionOtherKey(key: string): boolean {
	return key === "Enter" || key === "Escape";
}

export function getQuestionOptionClasses(input: {
	readonly selected: boolean;
	readonly isInteractive: boolean;
}): string {
	return [
		"flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors overflow-hidden",
		input.selected ? "bg-accent" : "bg-muted/50",
		input.isInteractive ? "cursor-pointer" : "",
		input.isInteractive && !input.selected ? "hover:bg-muted" : "",
		input.isInteractive && input.selected ? "hover:bg-accent/80" : "",
	]
		.filter(Boolean)
		.join(" ");
}
