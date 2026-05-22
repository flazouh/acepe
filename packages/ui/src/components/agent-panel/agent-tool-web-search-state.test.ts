import { describe, expect, test } from "bun:test";
import {
	getDisplayedWebSearchLinks,
	getHiddenWebSearchLinkCount,
	getWebSearchDomainShortLabel,
	getWebSearchHeaderLabel,
	getWebSearchResultText,
	hasMoreWebSearchLinks,
	hasWebSearchLinks,
	hasWebSearchSummary,
	isWebSearchDone,
	isWebSearchError,
	isWebSearchPending,
	shouldShowWebSearchNoResults,
	WEB_SEARCH_COLLAPSED_LIMIT,
	type WebSearchLink,
} from "./agent-tool-web-search-state.js";

function makeLinks(count: number): WebSearchLink[] {
	return Array.from({ length: count }, (_, index) => ({
		title: `Result ${index + 1}`,
		url: `https://example.com/${index + 1}`,
		domain: "www.example.com",
	}));
}

describe("agent tool web search state", () => {
	test("detects status groups", () => {
		expect(isWebSearchPending("pending")).toBe(true);
		expect(isWebSearchPending("running")).toBe(true);
		expect(isWebSearchPending("done")).toBe(false);
		expect(isWebSearchDone("done")).toBe(true);
		expect(isWebSearchError("error")).toBe(true);
	});

	test("detects links and non-empty summary", () => {
		expect(hasWebSearchLinks(makeLinks(1))).toBe(true);
		expect(hasWebSearchLinks([])).toBe(false);
		expect(hasWebSearchSummary(" summary ")).toBe(true);
		expect(hasWebSearchSummary("   ")).toBe(false);
		expect(hasWebSearchSummary(null)).toBe(false);
	});

	test("limits displayed links until show all is enabled", () => {
		const links = makeLinks(WEB_SEARCH_COLLAPSED_LIMIT + 2);

		expect(getDisplayedWebSearchLinks(links, false)).toHaveLength(
			WEB_SEARCH_COLLAPSED_LIMIT
		);
		expect(getDisplayedWebSearchLinks(links, true)).toHaveLength(links.length);
		expect(getHiddenWebSearchLinkCount(links)).toBe(2);
		expect(hasMoreWebSearchLinks(links)).toBe(true);
		expect(hasMoreWebSearchLinks(makeLinks(WEB_SEARCH_COLLAPSED_LIMIT))).toBe(
			false
		);
	});

	test("shows result text only for done searches with links", () => {
		const label = (count: number) => `${count} results`;

		expect(getWebSearchResultText({ status: "done", linkCount: 2 }, label)).toBe(
			"2 results"
		);
		expect(getWebSearchResultText({ status: "done", linkCount: 0 }, label)).toBeNull();
		expect(
			getWebSearchResultText({ status: "running", linkCount: 2 }, label)
		).toBeNull();
	});

	test("chooses header label by status", () => {
		const labels = {
			searchingLabel: "Searching",
			searchFailedLabel: "Search failed",
			searchedLabel: "Searched",
		};

		expect(getWebSearchHeaderLabel("pending", labels)).toBe("Searching");
		expect(getWebSearchHeaderLabel("error", labels)).toBe("Search failed");
		expect(getWebSearchHeaderLabel("done", labels)).toBe("Searched");
	});

	test("shows no results only for done searches without content", () => {
		expect(
			shouldShowWebSearchNoResults({
				status: "done",
				hasLinks: false,
				hasSummary: false,
			})
		).toBe(true);
		expect(
			shouldShowWebSearchNoResults({
				status: "done",
				hasLinks: true,
				hasSummary: false,
			})
		).toBe(false);
		expect(
			shouldShowWebSearchNoResults({
				status: "running",
				hasLinks: false,
				hasSummary: false,
			})
		).toBe(false);
	});

	test("creates short domain labels for compact rows", () => {
		expect(getWebSearchDomainShortLabel("www.example.com")).toBe("example");
		expect(getWebSearchDomainShortLabel("docs.github.com")).toBe("docs.gi");
		expect(getWebSearchDomainShortLabel("localhost")).toBe("");
	});
});
