import type { SearchResult } from "../components/tool-calls/tool-call-search/types/search-result.js";
import type { WebSearchResult } from "../components/tool-calls/tool-call-web-search/types/web-search-result.js";

export interface FetchHeaderMetadata {
	readonly name: string;
	readonly value: string;
}

export interface NormalizedExecuteResult {
	readonly kind: "execute";
	readonly stdout: string | null;
	readonly stderr: string | null;
	readonly exitCode: number | undefined;
}

export interface NormalizedSearchResult extends SearchResult {
	readonly kind: "search";
}

export interface NormalizedFetchResult {
	readonly kind: "fetch";
	readonly responseBody: string | null;
	readonly statusCode: number | null;
	readonly headers: readonly FetchHeaderMetadata[];
	readonly contentType: string | null;
}

export interface NormalizedWebSearchResult extends WebSearchResult {
	readonly kind: "web_search";
}

export interface NormalizedBrowserResult {
	readonly kind: "browser";
	readonly content: string | null;
	readonly detailedContent: string | null;
	readonly screenshotUrl: string | null;
	readonly outcome: "success" | "failure" | null;
}

export type NormalizedToolResult =
	| NormalizedExecuteResult
	| NormalizedSearchResult
	| NormalizedFetchResult
	| NormalizedWebSearchResult
	| NormalizedBrowserResult;

export function isExecuteNormalizedResult(
	result: NormalizedToolResult | null | undefined
): result is NormalizedExecuteResult {
	return result?.kind === "execute";
}

export function isSearchNormalizedResult(
	result: NormalizedToolResult | null | undefined
): result is NormalizedSearchResult {
	return result?.kind === "search";
}

export function isFetchNormalizedResult(
	result: NormalizedToolResult | null | undefined
): result is NormalizedFetchResult {
	return result?.kind === "fetch";
}

export function isWebSearchNormalizedResult(
	result: NormalizedToolResult | null | undefined
): result is NormalizedWebSearchResult {
	return result?.kind === "web_search";
}

export function isBrowserNormalizedResult(
	result: NormalizedToolResult | null | undefined
): result is NormalizedBrowserResult {
	return result?.kind === "browser";
}
