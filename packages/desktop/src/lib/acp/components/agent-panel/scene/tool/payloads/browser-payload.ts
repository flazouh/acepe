import type { ToolCall } from "../../../../../types/tool-call.js";
import { isBrowserNormalizedResult, serializeToolResult } from "../tool-result.js";

function readBrowserScript(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "browser") {
		return null;
	}

	const topLevel = toolCall.arguments.script?.trim();
	if (topLevel) {
		return topLevel;
	}

	const raw = toolCall.arguments.raw;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const rawScript = (raw as Record<string, unknown>).script;
		if (typeof rawScript === "string" && rawScript.trim().length > 0) {
			return rawScript.trim();
		}
	}

	return null;
}

export function mapBrowserPayload(toolCall: ToolCall): {
	detailsText?: string | null;
	scriptText?: string | null;
} {
	if (toolCall.kind !== "browser") {
		return {};
	}

	const scriptText = readBrowserScript(toolCall);

	if (isBrowserNormalizedResult(toolCall.normalizedResult)) {
		return {
			detailsText:
				toolCall.normalizedResult.detailedContent ?? toolCall.normalizedResult.content ?? null,
			scriptText,
		};
	}

	return {
		detailsText: serializeToolResult(toolCall.result),
		scriptText,
	};
}
