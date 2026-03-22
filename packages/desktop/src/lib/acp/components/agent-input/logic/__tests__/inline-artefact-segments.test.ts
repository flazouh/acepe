import { describe, expect, it } from "bun:test";

import {
	findInlineArtefactRangeAtPosition,
	tokenizeInlineArtefacts,
} from "../inline-artefact-segments.js";

describe("tokenizeInlineArtefacts", () => {
	it("returns single text segment when no tokens exist", () => {
		const segments = tokenizeInlineArtefacts("hello world");
		expect(segments).toEqual([{ kind: "text", text: "hello world" }]);
	});

	it("splits file tokens into artefact segments", () => {
		const segments = tokenizeInlineArtefacts("read @[file:/tmp/src/main.ts] next");
		expect(segments).toEqual([
			{ kind: "text", text: "read " },
			{
				kind: "artefact",
				tokenType: "file",
				value: "/tmp/src/main.ts",
				label: "main.ts",
				start: 5,
				end: 29,
				token: "@[file:/tmp/src/main.ts]",
			},
			{ kind: "text", text: " next" },
		]);
	});

	it("keeps unknown token types as plain text", () => {
		const segments = tokenizeInlineArtefacts("run @[unknown:foo] now");
		expect(segments).toEqual([{ kind: "text", text: "run @[unknown:foo] now" }]);
	});

	it("supports adjacent tokens", () => {
		const segments = tokenizeInlineArtefacts("@[file:/a.ts]@[image:/b.png]");
		expect(segments).toEqual([
			{
				kind: "artefact",
				tokenType: "file",
				value: "/a.ts",
				label: "a.ts",
				start: 0,
				end: 13,
				token: "@[file:/a.ts]",
			},
			{
				kind: "artefact",
				tokenType: "image",
				value: "/b.png",
				label: "b.png",
				start: 13,
				end: 28,
				token: "@[image:/b.png]",
			},
		]);
	});

	it("derives pasted-text chip metadata from text tokens", () => {
		const segments = tokenizeInlineArtefacts("use @[text:YWJj]");
		expect(segments).toEqual([
			{ kind: "text", text: "use " },
			{
				kind: "artefact",
				tokenType: "text",
				value: "YWJj",
				label: "abc",
				charCount: 3,
				title: "abc",
				start: 4,
				end: 16,
				token: "@[text:YWJj]",
			},
		]);
	});

	it("labels text_ref tokens as pasted text", () => {
		const segments = tokenizeInlineArtefacts("use @[text_ref:abc123]");
		expect(segments).toEqual([
			{ kind: "text", text: "use " },
			{
				kind: "artefact",
				tokenType: "text_ref",
				value: "abc123",
				label: "Pasted text",
				start: 4,
				end: 22,
				token: "@[text_ref:abc123]",
			},
		]);
	});

	it("labels command tokens with full command text", () => {
		const segments = tokenizeInlineArtefacts("run @[command:/review]");
		expect(segments).toEqual([
			{ kind: "text", text: "run " },
			{
				kind: "artefact",
				tokenType: "command",
				value: "/review",
				label: "/review",
				start: 4,
				end: 22,
				token: "@[command:/review]",
			},
		]);
	});

	it("labels skill tokens without leading slash", () => {
		const segments = tokenizeInlineArtefacts("use @[skill:/Plan_review]");
		expect(segments).toEqual([
			{ kind: "text", text: "use " },
			{
				kind: "artefact",
				tokenType: "skill",
				value: "/Plan_review",
				label: "Plan_review",
				start: 4,
				end: 25,
				token: "@[skill:/Plan_review]",
			},
		]);
	});

	it("finds token range by cursor position", () => {
		const text = "a @[file:/x.ts] b";
		expect(findInlineArtefactRangeAtPosition(text, 3)).toEqual({ start: 2, end: 15 });
		expect(findInlineArtefactRangeAtPosition(text, 14)).toEqual({ start: 2, end: 15 });
		expect(findInlineArtefactRangeAtPosition(text, 1)).toBeNull();
	});
});
