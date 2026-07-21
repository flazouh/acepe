import type { ToolCall } from "../../../../types/tool-call.js";

function capitalizeLeadingCharacter(value: string): string {
	if (value.length === 0) {
		return value;
	}
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function resolveTaskSubagent(
	toolCall: ToolCall
): { description: string | null; prompt: string | null } | null {
	if (toolCall.arguments.kind !== "think") {
		return null;
	}

	const descriptionFromArgs = toolCall.arguments.description?.trim() ?? "";
	const descriptionFromSubagentType = toolCall.arguments.subagent_type?.trim() ?? "";
	const description =
		descriptionFromArgs.length > 0
			? capitalizeLeadingCharacter(descriptionFromArgs)
			: descriptionFromSubagentType.length > 0
				? capitalizeLeadingCharacter(descriptionFromSubagentType)
				: null;

	return {
		description,
		prompt: toolCall.arguments.prompt ?? null,
	};
}
