import type {
	NormalizedBrowserResult,
	NormalizedFetchResult,
	NormalizedSearchResult,
	NormalizedWebSearchResult,
} from "../../../../types/normalized-tool-result.js";
import type { ToolCall } from "../../../../types/tool-call.js";

export function serializeOtherToolDetails(toolCall: ToolCall): string | null {
	if (toolCall.kind !== "other" && toolCall.kind !== "unclassified") {
		return null;
	}

	return JSON.stringify(
		{
			id: toolCall.id,
			name: toolCall.name,
			kind: toolCall.kind,
			title: toolCall.title,
			status: toolCall.status,
			arguments: toolCall.arguments,
			result: toolCall.result,
			locations: toolCall.locations,
			skillMeta: toolCall.skillMeta,
			normalizedQuestions: toolCall.normalizedQuestions,
			normalizedTodos: toolCall.normalizedTodos,
			parentToolUseId: toolCall.parentToolUseId,
			questionAnswer: toolCall.questionAnswer,
			awaitingPlanApproval: toolCall.awaitingPlanApproval,
			planApprovalRequestId: toolCall.planApprovalRequestId,
		},
		null,
		2
	);
}

export function isSearchNormalizedResult(
	result: ToolCall["normalizedResult"]
): result is NormalizedSearchResult {
	return result?.kind === "search";
}

export function isFetchNormalizedResult(
	result: ToolCall["normalizedResult"]
): result is NormalizedFetchResult {
	return result?.kind === "fetch";
}

export function isWebSearchNormalizedResult(
	result: ToolCall["normalizedResult"]
): result is NormalizedWebSearchResult {
	return result?.kind === "web_search";
}

export function isBrowserNormalizedResult(
	result: ToolCall["normalizedResult"]
): result is NormalizedBrowserResult {
	return result?.kind === "browser";
}

export function serializeToolResult(result: ToolCall["result"]): string | null {
	if (result === null || result === undefined) {
		return null;
	}

	if (typeof result === "string") {
		return result;
	}

	return JSON.stringify(result, null, 2);
}

export function getToolResultObject(toolCall: ToolCall): Record<string, unknown> | null {
	const { result } = toolCall;
	if (
		result === null ||
		result === undefined ||
		typeof result !== "object" ||
		Array.isArray(result)
	) {
		return null;
	}

	return result as Record<string, unknown>;
}
