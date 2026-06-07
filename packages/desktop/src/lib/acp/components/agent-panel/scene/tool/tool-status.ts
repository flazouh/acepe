import type { AgentToolStatus } from "@acepe/ui/agent-panel/types";
import type { ToolCall } from "../../../../types/tool-call.js";
import type { TurnState } from "../../../../store/types.js";

export function hasToolResult(toolCall: ToolCall): boolean {
	const hasRawResult = toolCall.result !== null && toolCall.result !== undefined;
	const hasNormalizedResult =
		toolCall.normalizedResult !== null && toolCall.normalizedResult !== undefined;
	if (
		toolCall.kind === "execute" ||
		toolCall.kind === "search" ||
		toolCall.kind === "fetch" ||
		toolCall.kind === "web_search" ||
		toolCall.kind === "browser"
	) {
		return hasRawResult || hasNormalizedResult;
	}

	return hasRawResult;
}

export function mapToolStatus(
	toolCall: ToolCall,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AgentToolStatus {
	if (toolCall.presentationStatus !== undefined) {
		return toolCall.presentationStatus;
	}

	if (toolCall.status === "failed") {
		return "error";
	}

	if (toolCall.status === "completed") {
		return "done";
	}

	const hasResult = hasToolResult(toolCall);
	if (hasResult || parentCompleted) {
		return "done";
	}

	if (toolCall.status === "in_progress") {
		return "running";
	}

	if (toolCall.status === "pending") {
		return "pending";
	}

	return turnState === "streaming" ? "pending" : "done";
}
