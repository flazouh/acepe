import { Result } from "neverthrow";
import type { JsonValue } from "$lib/services/converted-session-types.js";

import type { WebSearchLink, WebSearchResult } from "../types/web-search-result.js";

/**
 * Extract domain from a URL string.
 */
function extractDomain(url: string): string {
	return Result.fromThrowable(
		() => new URL(url),
		() => new Error("invalid")
	)()
		.map((u: URL) => u.hostname.replace(/^www\./, ""))
		.unwrapOr(url);
}

/**
 * Try to parse a link-like object into a WebSearchLink.
 */
function tryParseLink(item: unknown): WebSearchLink | null {
	if (!item || typeof item !== "object") return null;
	const obj = item as Record<string, unknown>;

	const url = (obj.url ?? obj.link ?? obj.href) as string | undefined;
	const title = (obj.title ?? obj.name ?? obj.text) as string | undefined;
	const pageAge = obj.page_age as string | undefined;

	if (!url || typeof url !== "string") return null;

	return {
		title: typeof title === "string" ? title : url,
		url,
		domain: extractDomain(url),
		pageAge,
	};
}

/**
 * Parse links from the "Links: [...]" text pattern.
 */
function parseLinksFromText(text: string): { links: WebSearchLink[]; summary: string } {
	const linksMatch = text.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
	if (!linksMatch?.[1]) return { links: [], summary: text };

	const summary = text.slice(0, linksMatch.index).trim();

	const parsed = Result.fromThrowable(
		() => JSON.parse(linksMatch[1]) as unknown[],
		() => new Error("parse")
	)();
	return parsed
		.map((arr: unknown[]) => arr.map(tryParseLink).filter((l): l is WebSearchLink => l !== null))
		.map((links: WebSearchLink[]) => ({ links, summary }))
		.unwrapOr({ links: [] as WebSearchLink[], summary: text });
}

/**
 * Parse links from "Sources:\n- [Title](url)" markdown pattern.
 */
function parseSourcesFromText(text: string): { links: WebSearchLink[]; summary: string } {
	const sourcesIdx = text.indexOf("Sources:");
	if (sourcesIdx === -1) return { links: [], summary: text };

	const summary = text.slice(0, sourcesIdx).trim();
	const sourcesSection = text.slice(sourcesIdx);

	const linkPattern = /- \[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
	const links: WebSearchLink[] = [];
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((match = linkPattern.exec(sourcesSection)) !== null) {
		const [, title, url] = match;
		if (title && url) {
			links.push({ title, url, domain: extractDomain(url) });
		}
	}

	return { links, summary };
}

/**
 * Parse web search result from raw JsonValue.
 *
 * Handles multiple formats:
 * 1. String with "Links: [{title, url}]" JSON block
 * 2. String with "Sources:\n- [Title](url)" markdown links
 * 3. Array of {title, url} objects (API content blocks)
 * 4. Object with search_results/results/content array
 * 5. Fallback: raw text display
 */
export function parseWebSearchResult(result: JsonValue | undefined | null): WebSearchResult {
	if (result === null || result === undefined) {
		return { links: [], summary: "" };
	}

	// String format - check for Links: [...] or Sources: patterns
	if (typeof result === "string") {
		const fromLinks = parseLinksFromText(result);
		if (fromLinks.links.length > 0) return fromLinks;

		const fromSources = parseSourcesFromText(result);
		if (fromSources.links.length > 0) return fromSources;

		return { links: [], summary: result };
	}

	// Array format - direct array of search result objects
	if (Array.isArray(result)) {
		const links = result.map(tryParseLink).filter((l): l is WebSearchLink => l !== null);
		return { links, summary: "" };
	}

	// Object format - look for nested arrays
	if (typeof result === "object") {
		const obj = result as Record<string, unknown>;

		// Check common nested array keys
		const candidates = [
			obj.search_results,
			obj.results,
			obj.content,
			obj.links,
			obj.items,
			obj.data,
		];

		for (const candidate of candidates) {
			if (Array.isArray(candidate)) {
				const links = candidate.map(tryParseLink).filter((l): l is WebSearchLink => l !== null);
				if (links.length > 0) {
					const summary =
						typeof obj.summary === "string"
							? obj.summary
							: typeof obj.text === "string"
								? obj.text
								: "";
					return { links, summary };
				}
			}
		}

		// Single result object with url/title at top level
		const singleLink = tryParseLink(obj);
		if (singleLink) {
			return { links: [singleLink], summary: "" };
		}

		// Fallback - stringify the object
		return { links: [], summary: JSON.stringify(result, null, 2) };
	}

	return { links: [], summary: String(result) };
}
