import type { JsonValue } from "$lib/services/converted-session-types.js";

import { isBrowserNormalizedResult } from "../../types/normalized-tool-result.js";
import type { NormalizedBrowserResult } from "../../types/normalized-tool-result.js";
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

type JsonObject = { readonly [key: string]: JsonValue };

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
	return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function stringifyJsonValue(value: JsonValue | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return JSON.stringify(value, null, 2);
}

function parseBrowserOutcome(result: JsonObject): "success" | "failure" | null {
	if (typeof result.success === "boolean") {
		return result.success ? "success" : "failure";
	}

	if (typeof result.ok === "boolean") {
		return result.ok ? "success" : "failure";
	}

	if (typeof result.status === "string") {
		if (result.status === "success" || result.status === "completed") {
			return "success";
		}
		if (result.status === "error" || result.status === "failed") {
			return "failure";
		}
	}

	return null;
}

export function parseBrowserToolResult(
	result: JsonValue | null | undefined
): NormalizedBrowserResult | null {
	if (result === null || result === undefined) {
		return null;
	}

	if (typeof result === "string") {
		return {
			kind: "browser",
			content: result,
			detailedContent: null,
			screenshotUrl: null,
			outcome: null,
		};
	}

	if (!isJsonObject(result)) {
		return null;
	}

	const content = stringifyJsonValue(result.content);
	const detailedContent = stringifyJsonValue(result.detailedContent);
	const screenshotUrl =
		typeof result.screenshotUrl === "string"
			? result.screenshotUrl
			: typeof result.screenshot_url === "string"
				? result.screenshot_url
				: null;
	const outcome = parseBrowserOutcome(result);

	if (content === null && detailedContent === null && screenshotUrl === null && outcome === null) {
		return null;
	}

	return {
		kind: "browser",
		content,
		detailedContent,
		screenshotUrl,
		outcome,
	};
}

export function extractBrowserScriptText(toolCall: ToolCall): string | null {
	const raw = getBrowserRawArguments(toolCall);
	if (!raw) {
		return null;
	}

	return typeof raw.script === "string" ? raw.script : null;
}

export function extractBrowserDetailsText(toolCall: ToolCall): string | null {
	const normalizedResult = isBrowserNormalizedResult(toolCall.normalizedResult)
		? toolCall.normalizedResult
		: parseBrowserToolResult(toolCall.result);
	if (normalizedResult !== null) {
		if (normalizedResult.detailedContent !== null) {
			return normalizedResult.detailedContent;
		}

		if (normalizedResult.content !== null) {
			return normalizedResult.content;
		}
	}

	const result = toolCall.result;
	if (result === null || result === undefined) {
		return null;
	}

	if (typeof result === "string") {
		return result;
	}

	return JSON.stringify(result, null, 2);
}
