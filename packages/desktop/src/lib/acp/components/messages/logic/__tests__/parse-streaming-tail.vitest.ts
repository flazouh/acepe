import { describe, expect, it } from "vitest";

import { parseStreamingTail } from "../parse-streaming-tail.js";

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
				{ key: "LIVE:1", kind: "live-text", text: "Hello" },
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
});
