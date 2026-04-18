import type { JsonValue } from "../../../services/converted-session-types.js";
import { parseToolResultWithExitCode } from "../../components/tool-calls/tool-call-execute/logic/parse-tool-result.js";
import { parseFetchResult } from "../../components/tool-calls/tool-call-fetch/logic/parse-fetch-result.js";
import { parseSearchResult } from "../../components/tool-calls/tool-call-search/logic/parse-grep-output.js";
import { parseWebSearchResult } from "../../components/tool-calls/tool-call-web-search/logic/parse-web-search-result.js";
import { parseBrowserToolResult } from "../../components/tool-calls/browser-tool-display.js";
import type {
	NormalizedExecuteResult,
	NormalizedSearchResult,
	NormalizedSqlResult,
	NormalizedToolResult,
	NormalizedWebSearchResult,
} from "../../types/normalized-tool-result.js";
import type { ToolCall } from "../../types/tool-call.js";

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

function isEmptyRawResult(result: JsonValue | null | undefined): boolean {
	return result === null || result === undefined || (typeof result === "string" && result.length === 0);
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

function extractSearchPath(argumentsValue: ToolCall["arguments"]): string | undefined {
	if (argumentsValue.kind === "search") {
		return argumentsValue.file_path ?? undefined;
	}

	if (argumentsValue.kind === "glob" && argumentsValue.pattern) {
		return argumentsValue.path ?? undefined;
	}

	return undefined;
}

export function resolveNormalizationKind(
	kind: ToolCall["kind"],
	argumentsValue: ToolCall["arguments"]
): ToolCall["kind"] {
	if (kind !== null && kind !== undefined && kind !== "other") {
		return kind;
	}

	if (argumentsValue.kind === "execute") {
		return "execute";
	}

	if (argumentsValue.kind === "search") {
		return "search";
	}

	if (argumentsValue.kind === "fetch") {
		return "fetch";
	}

	if (argumentsValue.kind === "webSearch") {
		return "web_search";
	}

	if (argumentsValue.kind === "browser") {
		return "browser";
	}

	if (argumentsValue.kind === "sql") {
		return "sql";
	}

	return kind;
}

function normalizeExecuteResult(result: JsonValue): NormalizedExecuteResult | null {
	const parsed = parseToolResultWithExitCode(result);
	if (parsed.stdout === null && parsed.stderr === null && parsed.exitCode === undefined) {
		return null;
	}

	return {
		kind: "execute",
		stdout: parsed.stdout,
		stderr: parsed.stderr,
		exitCode: parsed.exitCode,
	};
}

function normalizeSearchResult(
	result: JsonValue,
	argumentsValue: ToolCall["arguments"]
): NormalizedSearchResult {
	const parsed = parseSearchResult(
		result,
		extractSearchToolResponseMeta(result),
		extractSearchPath(argumentsValue)
	);

	return {
		kind: "search",
		mode: parsed.mode,
		numFiles: parsed.numFiles,
		numMatches: parsed.numMatches,
		matches: parsed.matches,
		files: parsed.files,
	};
}

function normalizeWebSearchResult(result: JsonValue): NormalizedWebSearchResult | null {
	const parsed = parseWebSearchResult(result);
	if (parsed.links.length === 0 && parsed.summary.length === 0) {
		return null;
	}

	return {
		kind: "web_search",
		links: parsed.links,
		summary: parsed.summary,
	};
}

function normalizeSqlResult(result: JsonValue): NormalizedSqlResult | null {
	if (typeof result === "string") {
		return {
			kind: "sql",
			rawText: result,
			rowCount: null,
		};
	}

	if (Array.isArray(result)) {
		return {
			kind: "sql",
			rawText: JSON.stringify(result, null, 2),
			rowCount: result.length,
		};
	}

	if (!isJsonObject(result)) {
		return {
			kind: "sql",
			rawText: JSON.stringify(result, null, 2),
			rowCount: null,
		};
	}

	const rows = Array.isArray(result.rows) ? result.rows : null;
	const rowCount =
		typeof result.rowCount === "number"
			? result.rowCount
			: typeof result.row_count === "number"
				? result.row_count
				: rows?.length ?? null;

	return {
		kind: "sql",
		rawText: JSON.stringify(result, null, 2),
		rowCount,
	};
}

export function normalizeToolResult(
	toolCall: Pick<ToolCall, "kind" | "arguments" | "result">
): NormalizedToolResult | null {
	if (isEmptyRawResult(toolCall.result)) {
		return null;
	}

	const result = toolCall.result;
	if (result === null || result === undefined) {
		return null;
	}

	const resolvedKind = resolveNormalizationKind(toolCall.kind, toolCall.arguments);

	if (resolvedKind === "execute") {
		return normalizeExecuteResult(result);
	}

	if (resolvedKind === "search") {
		return normalizeSearchResult(result, toolCall.arguments);
	}

	if (resolvedKind === "fetch") {
		return parseFetchResult(result);
	}

	if (resolvedKind === "web_search") {
		return normalizeWebSearchResult(result);
	}

	if (resolvedKind === "browser") {
		return parseBrowserToolResult(result);
	}

	if (resolvedKind === "sql") {
		return normalizeSqlResult(result);
	}

	return null;
}
