import type { AgentSearchMatch, AgentToolStatus } from "./types.js";

export const SEARCH_COLLAPSED_LIMIT = 5;

export type SearchToolVariant = "grep" | "glob";

export interface SearchQuerySegment {
	readonly raw: string;
	readonly html: string;
}

export function escapeSearchQueryHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function splitSearchQuerySegments(value: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inCharacterClass = false;
	let escaped = false;

	for (const character of value) {
		if (escaped) {
			current += `\\${character}`;
			escaped = false;
			continue;
		}

		if (character === "\\") {
			escaped = true;
			continue;
		}

		if (character === "[") {
			inCharacterClass = true;
			current += character;
			continue;
		}

		if (character === "]") {
			inCharacterClass = false;
			current += character;
			continue;
		}

		if (!inCharacterClass && (character === "|" || character === "\n" || character === "\r")) {
			const trimmed = current.trim();
			if (trimmed) segments.push(trimmed);
			current = "";
			continue;
		}

		current += character;
	}

	if (escaped) {
		current += "\\";
	}

	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);
	return segments.length > 0 ? segments : [" "];
}

export function highlightSearchQuerySegment(segment: string): string {
	return escapeSearchQueryHtml(segment).replace(
		/([()[\]{}+*?.^$|\\])/g,
		'<span class="search-query-token">$1</span>'
	);
}

export function createSearchQuerySegments(query: string | null): readonly SearchQuerySegment[] {
	if (!query) {
		return [];
	}

	return splitSearchQuerySegments(query).map((segment) => ({
		raw: segment,
		html: highlightSearchQuerySegment(segment),
	}));
}

export function isSearchToolPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function getSearchToolHeaderLabel(input: {
	readonly variant: SearchToolVariant;
	readonly status: AgentToolStatus;
	readonly findingLabel: string;
	readonly foundLabel: string;
	readonly greppingLabel: string;
	readonly greppedLabel: string;
}): string {
	const isPending = isSearchToolPending(input.status);
	if (input.variant === "glob") {
		return isPending ? input.findingLabel : input.foundLabel;
	}
	return isPending ? input.greppingLabel : input.greppedLabel;
}

export function getSearchResultText(input: {
	readonly status: AgentToolStatus;
	readonly resultCount: number | undefined;
	readonly fileCount: number;
	readonly resultCountLabel: (count: number) => string;
}): string | null {
	if (input.status !== "done") {
		return null;
	}

	return input.resultCountLabel(input.resultCount ?? input.fileCount);
}

export function getDisplayedSearchFiles(input: {
	readonly files: readonly string[];
	readonly showAll: boolean;
	readonly limit?: number;
}): readonly string[] {
	if (input.showAll) {
		return input.files;
	}
	return input.files.slice(0, input.limit ?? SEARCH_COLLAPSED_LIMIT);
}

export function getDisplayedSearchMatches(input: {
	readonly matches: readonly AgentSearchMatch[];
	readonly showAll: boolean;
	readonly limit?: number;
}): readonly AgentSearchMatch[] {
	if (input.showAll) {
		return input.matches;
	}
	return input.matches.slice(0, input.limit ?? SEARCH_COLLAPSED_LIMIT);
}

export function getHiddenSearchResultCount(input: {
	readonly fileCount: number;
	readonly matchCount: number;
	readonly hasMatches: boolean;
	readonly limit?: number;
}): number {
	const total = input.hasMatches ? input.matchCount : input.fileCount;
	return Math.max(0, total - (input.limit ?? SEARCH_COLLAPSED_LIMIT));
}
