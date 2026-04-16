import { describe, expect, it } from "vitest";

import { parseWebSearchResult } from "../parse-web-search-result.js";

describe("parseWebSearchResult", () => {
	it("parses structured search results into links and summary", () => {
		const parsed = parseWebSearchResult({
			summary: "Found references",
			search_results: [
				{ title: "Acepe", url: "https://acepe.dev" },
				{ title: "Docs", url: "https://docs.acepe.dev", page_age: "2 days ago" },
			],
		});

		expect(parsed).toEqual({
			summary: "Found references",
			links: [
				{ title: "Acepe", url: "https://acepe.dev", domain: "acepe.dev" },
				{
					title: "Docs",
					url: "https://docs.acepe.dev",
					domain: "docs.acepe.dev",
					pageAge: "2 days ago",
				},
			],
		});
	});

	it("parses markdown sources blocks from string output", () => {
		const parsed = parseWebSearchResult(
			[
				"Acepe summary",
				"",
				"Sources:",
				"- [Acepe](https://acepe.dev)",
				"- [Docs](https://docs.acepe.dev)",
			].join("\n")
		);

		expect(parsed.summary).toBe("Acepe summary");
		expect(parsed.links).toEqual([
			{ title: "Acepe", url: "https://acepe.dev", domain: "acepe.dev" },
			{ title: "Docs", url: "https://docs.acepe.dev", domain: "docs.acepe.dev" },
		]);
	});

	it("falls back to serialized text for malformed objects", () => {
		const parsed = parseWebSearchResult({
			unexpected: true,
			count: 2,
		});

		expect(parsed.links).toEqual([]);
		expect(parsed.summary).toContain('"unexpected": true');
		expect(parsed.summary).toContain('"count": 2');
	});
});
