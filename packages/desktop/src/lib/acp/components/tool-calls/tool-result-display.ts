import { safeJsonStringify } from "../../logic/json-utils.js";
import type { JsonValue } from "../../../services/converted-session-types.js";
import {
	isExecuteNormalizedResult,
	isFetchNormalizedResult,
	isSearchNormalizedResult,
	isWebSearchNormalizedResult,
	type NormalizedFetchResult,
} from "../../types/normalized-tool-result.js";
import type { ToolCall } from "../../types/tool-call.js";
import {
	parseToolResultOutput,
	parseToolResultWithExitCode,
	type ParsedToolResult,
} from "./tool-call-execute/logic/parse-tool-result.js";
import { parseFetchResult } from "./tool-call-fetch/logic/parse-fetch-result.js";
import { parseSearchResult } from "./tool-call-search/logic/parse-grep-output.js";
import type { SearchResult } from "./tool-call-search/types/search-result.js";
import { parseWebSearchResult } from "./tool-call-web-search/logic/parse-web-search-result.js";
import type { WebSearchResult } from "./tool-call-web-search/types/web-search-result.js";

type JsonObject = { readonly [key: string]: JsonValue };

interface SearchToolResponseMeta {
	readonly mode?: string;
	readonly numFiles?: number;
	readonly numLines?: number;
	readonly filenames?: string[];
	readonly content?: string;
}

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
	return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function extractSearchToolResponseMeta(result: JsonValue | null | undefined): SearchToolResponseMeta | undefined {
	if (!isJsonObject(result)) {
		return undefined;
	}

	let filenames: string[] | undefined;
	if (Array.isArray(result.filenames)) {
		const nextFilenames: string[] = [];
		for (const value of result.filenames) {
			if (typeof value === "string") {
				nextFilenames.push(value);
			}
		}
		filenames = nextFilenames;
	}

	return {
		mode: typeof result.mode === "string" ? result.mode : undefined,
		numFiles:
			typeof result.numFiles === "number"
				? result.numFiles
				: typeof result.totalFiles === "number"
					? result.totalFiles
					: undefined,
		numLines: typeof result.numLines === "number" ? result.numLines : undefined,
		filenames,
		content: typeof result.content === "string" ? result.content : undefined,
	};
}

function stringifyResult(value: ToolCall["result"]): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	return JSON.stringify(value, null, 2);
}

export function resolveExecuteDisplayResult(toolCall: ToolCall): ParsedToolResult {
	if (isExecuteNormalizedResult(toolCall.normalizedResult)) {
		return {
			stdout: toolCall.normalizedResult.stdout,
			stderr: toolCall.normalizedResult.stderr,
			exitCode: toolCall.normalizedResult.exitCode,
		};
	}

	return parseToolResultWithExitCode(toolCall.result);
}

export function resolveExecuteFallbackOutputText(toolCall: ToolCall): string | null {
	if (isExecuteNormalizedResult(toolCall.normalizedResult)) {
		return null;
	}

	const parsedOutput = parseToolResultOutput(toolCall.result);
	if (parsedOutput.isOk() && parsedOutput.value) {
		return parsedOutput.value;
	}

	const stringifiedResult = safeJsonStringify(toolCall.result);
	if (stringifiedResult.isOk()) {
		return stringifiedResult.value;
	}

	if (toolCall.result === null || toolCall.result === undefined) {
		return null;
	}

	return String(toolCall.result);
}

export function resolveSearchDisplayResult(
	toolCall: ToolCall,
	searchPath: string | undefined
): SearchResult {
	if (isSearchNormalizedResult(toolCall.normalizedResult)) {
		return {
			mode: toolCall.normalizedResult.mode,
			numFiles: toolCall.normalizedResult.numFiles,
			numMatches: toolCall.normalizedResult.numMatches,
			matches: toolCall.normalizedResult.matches,
			files: toolCall.normalizedResult.files,
		};
	}

	return parseSearchResult(
		toolCall.result,
		extractSearchToolResponseMeta(toolCall.result),
		searchPath
	);
}

export function resolveFetchDisplayResult(toolCall: ToolCall): NormalizedFetchResult | null {
	if (isFetchNormalizedResult(toolCall.normalizedResult)) {
		return toolCall.normalizedResult;
	}

	return parseFetchResult(toolCall.result);
}

export function resolveFetchResultText(toolCall: ToolCall): string | null {
	const normalizedResult = resolveFetchDisplayResult(toolCall);
	if (normalizedResult !== null) {
		return normalizedResult.responseBody;
	}

	return stringifyResult(toolCall.result);
}

export function resolveWebSearchDisplayResult(toolCall: ToolCall): WebSearchResult {
	if (isWebSearchNormalizedResult(toolCall.normalizedResult)) {
		return {
			links: toolCall.normalizedResult.links,
			summary: toolCall.normalizedResult.summary,
		};
	}

	return parseWebSearchResult(toolCall.result);
}
