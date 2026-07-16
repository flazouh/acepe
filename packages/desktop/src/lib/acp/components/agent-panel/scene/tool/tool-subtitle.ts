import type { ToolCall } from "../../../../types/tool-call.js";

function truncateBrowserSubtitle(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function getWriteBashSubtitle(toolCall: ToolCall): string | undefined {
	if (toolCall.arguments.kind !== "shellInput") {
		return undefined;
	}

	const shellId = toolCall.arguments.shell_id?.trim() ?? null;
	const input = toolCall.arguments.input?.trim() ?? null;

	if (shellId && input) {
		return `Shell ${shellId}: ${input}`;
	}

	if (input) {
		return `Input: ${input}`;
	}

	if (shellId) {
		return `Shell ${shellId}`;
	}

	return undefined;
}

export function getToolSubtitle(toolCall: ToolCall): string | undefined {
	const writeBashSubtitle = getWriteBashSubtitle(toolCall);
	if (writeBashSubtitle) {
		return writeBashSubtitle;
	}

	if (toolCall.arguments.kind === "browser") {
		const action = toolCall.arguments.action?.trim();
		const selector = toolCall.arguments.selector?.trim();
		if (action && selector) {
			return `${action} -> ${truncateBrowserSubtitle(selector, 30)}`;
		}
		if (action) {
			return action;
		}
		if (selector) {
			return truncateBrowserSubtitle(selector, 40);
		}
		// Script stays on scriptText / the Script section — not the title row.
		return undefined;
	}

	if (toolCall.arguments.kind === "execute") {
		return toolCall.arguments.command ?? undefined;
	}

	if (toolCall.arguments.kind === "search" || toolCall.arguments.kind === "webSearch") {
		return toolCall.arguments.query ?? undefined;
	}

	if (toolCall.arguments.kind === "fetch") {
		return toolCall.arguments.url ?? undefined;
	}

	if (toolCall.arguments.kind === "think") {
		return toolCall.arguments.description ?? undefined;
	}

	if (toolCall.arguments.kind === "other") {
		const intent = toolCall.arguments.intent?.trim();
		if (intent && intent.length > 0) {
			return intent;
		}
	}

	const firstTodo = toolCall.normalizedTodos?.find((todo) => todo.status === "in_progress");
	if (firstTodo) {
		return firstTodo.activeForm || firstTodo.content;
	}

	const firstQuestion = toolCall.normalizedQuestions?.[0];
	if (firstQuestion) {
		return firstQuestion.question;
	}

	return undefined;
}

export function getToolFilePath(toolCall: ToolCall): string | undefined {
	if (toolCall.arguments.kind === "read") {
		return toolCall.arguments.file_path ?? toolCall.arguments.source_context?.path ?? undefined;
	}

	if (toolCall.arguments.kind === "search") {
		return toolCall.arguments.file_path ?? undefined;
	}

	if (toolCall.arguments.kind === "edit") {
		return (
			toolCall.arguments.edits[0]?.filePath ?? toolCall.arguments.edits[0]?.moveFrom ?? undefined
		);
	}

	if (toolCall.arguments.kind === "delete") {
		return toolCall.arguments.file_path ?? toolCall.arguments.file_paths?.[0] ?? undefined;
	}

	if (toolCall.arguments.kind === "move") {
		return toolCall.arguments.to ?? toolCall.arguments.from ?? undefined;
	}

	return undefined;
}
