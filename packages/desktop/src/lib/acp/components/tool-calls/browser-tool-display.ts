import type { ToolCall } from "../../types/tool-call.js";

function getBrowserRawArguments(toolCall: ToolCall): Record<string, unknown> | null {
	if (toolCall.arguments.kind !== "browser" && toolCall.arguments.kind !== "other") {
		return null;
	}

	const raw = toolCall.arguments.raw;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return null;
	}

	return raw as Record<string, unknown>;
}

export function extractBrowserScriptText(toolCall: ToolCall): string | null {
	const raw = getBrowserRawArguments(toolCall);
	if (!raw) {
		return null;
	}

	return typeof raw.script === "string" ? raw.script : null;
}

export function extractBrowserDetailsText(toolCall: ToolCall): string | null {
	const result = toolCall.result;
	if (result === null || result === undefined) {
		return null;
	}

	if (typeof result === "string") {
		return result;
	}

	if (typeof result === "object" && !Array.isArray(result)) {
		const content = result.content;
		if (typeof content === "string") {
			return content;
		}

		const detailedContent = result.detailedContent;
		if (typeof detailedContent === "string") {
			return detailedContent;
		}
	}

	return JSON.stringify(result, null, 2);
}
