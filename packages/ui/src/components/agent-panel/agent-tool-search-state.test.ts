import { describe, expect, it } from "bun:test";

import {
	createSearchQuerySegments,
	escapeSearchQueryHtml,
	getDisplayedSearchFiles,
	getDisplayedSearchMatches,
	getHiddenSearchResultCount,
	getSearchResultText,
	getSearchToolHeaderLabel,
	highlightSearchQuerySegment,
	splitSearchQuerySegments,
} from "./agent-tool-search-state.js";
import type { AgentSearchMatch } from "./types.js";

const matches: readonly AgentSearchMatch[] = [
	{ filePath: "a.ts", fileName: "a.ts", lineNumber: 1, content: "a", isMatch: true },
	{ filePath: "b.ts", fileName: "b.ts", lineNumber: 2, content: "b", isMatch: true },
	{ filePath: "c.ts", fileName: "c.ts", lineNumber: 3, content: "c", isMatch: true },
	{ filePath: "d.ts", fileName: "d.ts", lineNumber: 4, content: "d", isMatch: true },
	{ filePath: "e.ts", fileName: "e.ts", lineNumber: 5, content: "e", isMatch: true },
	{ filePath: "f.ts", fileName: "f.ts", lineNumber: 6, content: "f", isMatch: true },
];

describe("agent tool search state", () => {
	it("escapes query HTML before rendering highlighted tokens", () => {
		expect(escapeSearchQueryHtml('<script>"x"&</script>')).toBe(
			"&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;"
		);
		expect(highlightSearchQuerySegment("foo.*")).toBe(
			'foo<span class="search-query-token">.</span><span class="search-query-token">*</span>'
		);
	});

	it("splits regex query alternatives without splitting character classes", () => {
		expect(splitSearchQuerySegments("foo|bar\nbaz")).toEqual(["foo", "bar", "baz"]);
		expect(splitSearchQuerySegments("foo[|]bar|baz")).toEqual(["foo[|]bar", "baz"]);
		expect(splitSearchQuerySegments("foo\\|bar")).toEqual(["foo\\|bar"]);
		expect(splitSearchQuerySegments("")).toEqual([" "]);
	});

	it("creates display query segments", () => {
		expect(createSearchQuerySegments("foo|bar")[0]).toEqual({
			raw: "foo",
			html: "foo",
		});
		expect(createSearchQuerySegments(null)).toEqual([]);
	});

	it("selects the right header label by variant and status", () => {
		const labels = {
			findingLabel: "Finding",
			foundLabel: "Found",
			greppingLabel: "Grepping",
			greppedLabel: "Grepped",
		};

		expect(getSearchToolHeaderLabel({ ...labels, variant: "glob", status: "running" })).toBe(
			"Finding"
		);
		expect(getSearchToolHeaderLabel({ ...labels, variant: "grep", status: "done" })).toBe(
			"Grepped"
		);
	});

	it("shows result text only when done", () => {
		const resultCountLabel = (count: number) => `${count} results`;
		expect(
			getSearchResultText({
				status: "running",
				resultCount: 12,
				fileCount: 5,
				resultCountLabel,
			})
		).toBeNull();
		expect(
			getSearchResultText({
				status: "done",
				resultCount: undefined,
				fileCount: 5,
				resultCountLabel,
			})
		).toBe("5 results");
	});

	it("limits displayed files and matches until show all is enabled", () => {
		expect(
			getDisplayedSearchFiles({
				files: ["a", "b", "c", "d", "e", "f"],
				showAll: false,
			})
		).toEqual(["a", "b", "c", "d", "e"]);
		expect(getDisplayedSearchMatches({ matches, showAll: false })).toHaveLength(5);
		expect(getDisplayedSearchMatches({ matches, showAll: true })).toHaveLength(6);
	});

	it("computes hidden result count for files or matches", () => {
		expect(getHiddenSearchResultCount({ fileCount: 8, matchCount: 0, hasMatches: false })).toBe(3);
		expect(getHiddenSearchResultCount({ fileCount: 8, matchCount: 9, hasMatches: true })).toBe(4);
		expect(getHiddenSearchResultCount({ fileCount: 2, matchCount: 0, hasMatches: false })).toBe(0);
	});
});
