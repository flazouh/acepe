import type { ToolCall } from "../../../../../types/tool-call.js";
import { isBrowserNormalizedResult, serializeToolResult } from "../tool-result.js";

export function mapBrowserPayload(toolCall: ToolCall): {
	detailsText?: string | null;
} {
	if (toolCall.kind !== "browser") {
		return {};
	}

	if (isBrowserNormalizedResult(toolCall.normalizedResult)) {
		return {
			detailsText:
				toolCall.normalizedResult.detailedContent ?? toolCall.normalizedResult.content ?? null,
		};
	}

	return {
		detailsText: serializeToolResult(toolCall.result),
	};
}
