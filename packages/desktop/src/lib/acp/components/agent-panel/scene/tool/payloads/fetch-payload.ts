import type { ToolCall } from "../../../../../types/tool-call.js";
import { isFetchNormalizedResult, serializeToolResult } from "../tool-result.js";

export function mapFetchResultText(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "fetch") {
		return null;
	}

	if (isFetchNormalizedResult(toolCall.normalizedResult)) {
		return toolCall.normalizedResult.responseBody;
	}

	return serializeToolResult(toolCall.result);
}
