/**
 * A single web search result link.
 */
export interface WebSearchLink {
	/** Page title */
	title: string;
	/** Full URL */
	url: string;
	/** Domain name (extracted from URL) */
	domain: string;
	/** Page age / freshness indicator (e.g. "2 days ago") */
	pageAge?: string;
}

/**
 * Parsed web search result.
 */
export interface WebSearchResult {
	/** Extracted search result links */
	links: WebSearchLink[];
	/** Summary text (if any, before the links section) */
	summary: string;
}
