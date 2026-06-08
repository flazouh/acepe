import type { ToolCall } from "../../../../../types/tool-call.js";

export function mapTaskDescription(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind === "think") {
		return toolCall.arguments.description ?? null;
	}

	if (toolCall.arguments.kind === "taskOutput") {
		return toolCall.arguments.task_id ? `Task: ${toolCall.arguments.task_id}` : null;
	}

	return null;
}

export function mapTaskResultText(toolCall: ToolCall): string | null {
	if (toolCall.kind !== "task" && toolCall.kind !== "task_output") {
		return null;
	}

	return typeof toolCall.result === "string" ? toolCall.result : null;
}
