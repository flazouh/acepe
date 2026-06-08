import type { ToolCall } from "../../../../../types/tool-call.js";
import { isWebSearchNormalizedResult } from "../tool-result.js";

export function mapWebSearchPayload(toolCall: ToolCall): {
	webSearchLinks?: {
		title: string;
		url: string;
		domain: string;
		pageAge?: string;
	}[];
	webSearchSummary?: string | null;
} {
	if (toolCall.arguments.kind !== "webSearch") {
		return {};
	}

	const normalizedResult = isWebSearchNormalizedResult(toolCall.normalizedResult)
		? toolCall.normalizedResult
		: null;
	if (normalizedResult === null) {
		return {};
	}

	return {
		webSearchLinks: normalizedResult.links.map((link) => ({
			title: link.title,
			url: link.url,
			domain: link.domain,
			pageAge: link.pageAge,
		})),
		webSearchSummary: normalizedResult.summary,
	};
}
