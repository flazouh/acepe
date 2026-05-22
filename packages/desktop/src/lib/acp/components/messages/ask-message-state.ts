import type { AnswerOption, AskMessage } from "../../types/ask-message.js";

export interface AskMessageOptionView {
	option: AnswerOption;
	shortcutLabel: string;
	isSelected: boolean;
}

export interface AskMessageDisplayState {
	options: AskMessageOptionView[];
}

export function buildAskMessageDisplayState(input: {
	message: AskMessage;
	selectedId: string | null;
}): AskMessageDisplayState {
	return {
		options: input.message.options.map((option, index) => ({
			option,
			shortcutLabel: getAskOptionShortcutLabel(index),
			isSelected: option.id === input.selectedId,
		})),
	};
}

export function getAskOptionShortcutLabel(index: number): string {
	return `Alt+${String(index + 1)}`;
}

export function getAskOptionIdFromKeyboardShortcut(
	event: Pick<KeyboardEvent, "altKey" | "key">,
	options: readonly AnswerOption[]
): string | null {
	if (!event.altKey || !/^\d$/.test(event.key)) {
		return null;
	}

	const index = Number.parseInt(event.key, 10) - 1;
	if (index < 0 || index >= options.length) {
		return null;
	}

	return options[index]?.id ?? null;
}
