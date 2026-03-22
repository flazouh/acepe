import type { ToolArguments } from "$lib/services/converted-session-types.js";

import type { ToolCall } from "../../../../types/tool-call.js";

export interface TaskSubagentView {
	subagentType: string | null;
	description: string | null;
	prompt: string | null;
}

function toNullableString(value: string | null | undefined): string | null {
	return value ?? null;
}

function getBaseThinkArguments(
	toolCall: ToolCall
): Extract<ToolArguments, { kind: "think" }> | null {
	return toolCall.arguments.kind === "think" ? toolCall.arguments : null;
}

function getStreamingThinkArguments(
	streamingArguments: ToolArguments | undefined
): Extract<ToolArguments, { kind: "think" }> | null {
	return streamingArguments?.kind === "think" ? streamingArguments : null;
}

export function resolveTaskSubagent(
	toolCall: ToolCall,
	streamingArguments: ToolArguments | undefined
): TaskSubagentView | null {
	const baseThinkArgs = getBaseThinkArguments(toolCall);
	const streamingThinkArgs = getStreamingThinkArguments(streamingArguments);

	if (!baseThinkArgs && !streamingThinkArgs) {
		return null;
	}

	return {
		subagentType: toNullableString(
			streamingThinkArgs?.subagent_type ?? baseThinkArgs?.subagent_type
		),
		description: toNullableString(streamingThinkArgs?.description ?? baseThinkArgs?.description),
		prompt: toNullableString(streamingThinkArgs?.prompt ?? baseThinkArgs?.prompt),
	};
}
