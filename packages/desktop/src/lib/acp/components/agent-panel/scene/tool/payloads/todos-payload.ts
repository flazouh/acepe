import type { ToolCall } from "../../../../../types/tool-call.js";

export function mapTodos(toolCall: ToolCall) {
	return toolCall.normalizedTodos?.map((todo) => {
		return {
			content: todo.content,
			activeForm: todo.activeForm,
			status: todo.status,
			duration: todo.duration ?? null,
		};
	});
}
