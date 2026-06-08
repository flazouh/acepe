import type { ToolCall } from "../../../../../types/tool-call.js";

export function mapQuestion(toolCall: ToolCall): {
	question: string;
	header?: string | null;
	options?: { label: string; description?: string | null }[] | null;
	multiSelect?: boolean;
} | null {
	const firstQuestion = toolCall.normalizedQuestions?.[0];
	if (!firstQuestion) {
		return null;
	}

	const options = firstQuestion.options.map((option) => {
		return {
			label: option.label,
			description: option.description ?? null,
		};
	});

	return {
		question: firstQuestion.question,
		header: firstQuestion.header,
		options,
		multiSelect: firstQuestion.multiSelect,
	};
}
