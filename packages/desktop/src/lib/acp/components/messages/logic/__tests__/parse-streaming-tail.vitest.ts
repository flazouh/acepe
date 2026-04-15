import { describe, expect, it } from "vitest";

import { parseStreamingTail, parseStreamingTailIncremental } from "../parse-streaming-tail.js";

describe("parseStreamingTail", () => {
	it("returns no sections for empty input", () => {
		expect(parseStreamingTail("")).toEqual({
			sections: [],
		});
	});

	it("keeps the trailing paragraph live while earlier blocks are settled", () => {
		expect(parseStreamingTail("# Title\n\nHello")).toEqual({
			sections: [
				{ key: "SETTLED:0", kind: "settled", markdown: "# Title" },
				{
					key: "LIVE:1",
					kind: "live-markdown",
					text: "Hello",
					markdown: "Hello",
					presentation: "paragraph",
					source: "Hello",
				},
			],
		});
	});

	it("promotes a live list tail when the revealed lines are safe list items", () => {
		expect(parseStreamingTail("- first\n- second")).toEqual({
			sections: [
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "- first\n- second",
					markdown: "- first\n- second",
					presentation: "list",
					source: "- first\n- second",
				},
			],
		});
	});

	it("splits safe mixed blocks in the live tail instead of flattening them", () => {
		expect(parseStreamingTail("# Title\nBody")).toEqual({
			sections: [
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "# Title",
					markdown: "# Title",
					presentation: "heading",
					source: "# Title",
				},
				{
					key: "LIVE:1",
					kind: "live-markdown",
					text: "Body",
					markdown: "Body",
					presentation: "paragraph",
					source: "Body",
				},
			],
		});
	});

	it("returns only settled sections when trailing blank lines flush the final buffer", () => {
		expect(parseStreamingTail("# Title\n\n")).toEqual({
			sections: [{ key: "SETTLED:0", kind: "settled", markdown: "# Title" }],
		});
	});

	it("keeps an open fenced code block live without the fence markers", () => {
		expect(parseStreamingTail("```ts\nconst a = 1;\nconst b = 2;")).toEqual({
			sections: [
				{
					key: "LIVE:0",
					kind: "live-code",
					code: "const a = 1;\nconst b = 2;",
					language: "ts",
					source: "```ts\nconst a = 1;\nconst b = 2;",
				},
			],
		});
	});

	it("keeps an open fenced code block live when no language is provided", () => {
		expect(parseStreamingTail("```\nconst a = 1;")).toEqual({
			sections: [
				{
					key: "LIVE:0",
					kind: "live-code",
					code: "const a = 1;",
					language: null,
					source: "```\nconst a = 1;",
				},
			],
		});
	});

	it("settles a fenced code block once the closing fence arrives", () => {
		expect(parseStreamingTail("```ts\nconst a = 1;\n```")).toEqual({
			sections: [
				{
					key: "SETTLED:0",
					kind: "settled",
					markdown: "```ts\nconst a = 1;\n```",
				},
			],
		});
	});

	it("reuses stable settled prefix sections for append-only reveal growth", () => {
		const previous = parseStreamingTail("# Title\n\nHello");
		const next = parseStreamingTailIncremental("# Title\n\nHello", previous, "# Title\n\nHello world");

		expect(next.sections).toEqual([
			{ key: "SETTLED:0", kind: "settled", markdown: "# Title" },
			{
				key: "LIVE:1",
				kind: "live-markdown",
				text: "Hello world",
				markdown: "Hello world",
				presentation: "paragraph",
				source: "Hello world",
			},
		]);
		expect(next.sections[0]).toBe(previous.sections[0]);
	});

	it("keeps an already-revealed heading stable when body text begins underneath it", () => {
		const previous = parseStreamingTail("# Title");
		const next = parseStreamingTailIncremental("# Title", previous, "# Title\nBody");

		expect(next.sections).toEqual([
			{
				key: "LIVE:0",
				kind: "live-markdown",
				text: "# Title",
				markdown: "# Title",
				presentation: "heading",
				source: "# Title",
			},
			{
				key: "LIVE:1",
				kind: "live-markdown",
				text: "Body",
				markdown: "Body",
				presentation: "paragraph",
				source: "Body",
			},
		]);
	});

	it("reparses only the previous live tail when reveal growth creates a new block", () => {
		const previous = parseStreamingTail("# Title\n\nHello");
		const next = parseStreamingTailIncremental("# Title\n\nHello", previous, "# Title\n\nHello\n\nNext");

		expect(next.sections).toEqual([
			{ key: "SETTLED:0", kind: "settled", markdown: "# Title" },
			{ key: "SETTLED:1", kind: "settled", markdown: "Hello" },
			{
				key: "LIVE:2",
				kind: "live-markdown",
				text: "Next",
				markdown: "Next",
				presentation: "paragraph",
				source: "Next",
			},
		]);
		expect(next.sections[0]).toBe(previous.sections[0]);
	});

	it("preserves partial fence headers when reparsing an incrementally grown live code block", () => {
		const previous = parseStreamingTail("```");
		const next = parseStreamingTailIncremental("```", previous, "```ts\nconst a = 1;");

		expect(next).toEqual(parseStreamingTail("```ts\nconst a = 1;"));
	});
});
