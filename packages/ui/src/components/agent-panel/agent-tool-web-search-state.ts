import type { AgentToolStatus } from "./types.js";

export const WEB_SEARCH_COLLAPSED_LIMIT = 6;

export interface WebSearchLink {
	title: string;
	url: string;
	domain: string;
	pageAge?: string;
}

export function isWebSearchPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function isWebSearchDone(status: AgentToolStatus): boolean {
	return status === "done";
}

export function isWebSearchError(status: AgentToolStatus): boolean {
	return status === "error";
}

export function hasWebSearchLinks(links: readonly WebSearchLink[]): boolean {
	return links.length > 0;
}

export function hasWebSearchSummary(summary?: string | null): boolean {
	return Boolean(summary && summary.trim().length > 0);
}

export function getDisplayedWebSearchLinks(
	links: readonly WebSearchLink[],
	showAll: boolean
): readonly WebSearchLink[] {
	return showAll ? links : links.slice(0, WEB_SEARCH_COLLAPSED_LIMIT);
}

export function getHiddenWebSearchLinkCount(
	links: readonly WebSearchLink[]
): number {
	return Math.max(0, links.length - WEB_SEARCH_COLLAPSED_LIMIT);
}

export function hasMoreWebSearchLinks(links: readonly WebSearchLink[]): boolean {
	return getHiddenWebSearchLinkCount(links) > 0;
}

export function getWebSearchResultText(
	input: {
		status: AgentToolStatus;
		linkCount: number;
	},
	resultCountLabel: (count: number) => string
): string | null {
	if (!isWebSearchDone(input.status)) return null;
	if (input.linkCount === 0) return null;
	return resultCountLabel(input.linkCount);
}

export function getWebSearchHeaderLabel(
	status: AgentToolStatus,
	labels: {
		searchingLabel: string;
		searchFailedLabel: string;
		searchedLabel: string;
	}
): string {
	if (isWebSearchPending(status)) return labels.searchingLabel;
	if (isWebSearchError(status)) return labels.searchFailedLabel;
	return labels.searchedLabel;
}

export function shouldShowWebSearchNoResults(input: {
	status: AgentToolStatus;
	hasLinks: boolean;
	hasSummary: boolean;
}): boolean {
	return isWebSearchDone(input.status) && !input.hasLinks && !input.hasSummary;
}

export function getWebSearchDomainShortLabel(domain: string): string {
	return domain.replace(/^www\./, "").split(".").slice(0, -1).join(".").slice(0, 7);
}
