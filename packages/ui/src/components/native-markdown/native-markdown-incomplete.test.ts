import { describe, expect, it } from "bun:test";

import { completeIncompleteMarkdown } from "./native-markdown-incomplete.js";

describe("completeIncompleteMarkdown", () => {
	describe("auto-closes dangling inline markdown", () => {
		it("closes a trailing bold opener", () => {
			expect(completeIncompleteMarkdown("**bold")).toBe("**bold**");
		});

		it("closes only the trailing unclosed bold, leaving the complete one alone", () => {
			expect(completeIncompleteMarkdown("a **bold** and **more")).toBe(
				"a **bold** and **more**",
			);
		});

		it("closes a trailing inline code span", () => {
			expect(completeIncompleteMarkdown("text `code")).toBe("text `code`");
		});

		it("closes a trailing double-backtick code span with a single backtick inside", () => {
			expect(completeIncompleteMarkdown("text ``code with ` inside")).toBe(
				"text ``code with ` inside``",
			);
		});

		it("closes a trailing strikethrough opener", () => {
			expect(completeIncompleteMarkdown("~~struck")).toBe("~~struck~~");
		});

		it("closes a trailing italic opener", () => {
			expect(completeIncompleteMarkdown("*italic")).toBe("*italic*");
		});

		it("closes a dangling link label with no literal bracket left dangling", () => {
			const result = completeIncompleteMarkdown("[link text");
			expect(result).not.toContain("[link text\n");
			// No raw, unclosed `[` should remain visible in the string tail.
			expect(/\[[^\]]*$/u.test(result)).toBe(false);
		});

		it("closes a trailing unfinished link URL", () => {
			expect(completeIncompleteMarkdown("[link](http://ex")).toBe(
				"[link](http://ex)",
			);
		});

		it("closes an open fenced code block", () => {
			const result = completeIncompleteMarkdown("```ts\nconst x = 1");
			expect(result.startsWith("```ts\nconst x = 1")).toBe(true);
			expect(result.trimEnd().endsWith("```")).toBe(true);
			// Exactly two fence lines: the opener and the appended closer.
			const fenceLines = result
				.split("\n")
				.filter((line) => line.trim().startsWith("```"));
			expect(fenceLines).toHaveLength(2);
		});
	});

	describe("leaves complete or ambiguous markdown unchanged", () => {
		it("leaves already-complete bold unchanged", () => {
			expect(completeIncompleteMarkdown("**bold**")).toBe("**bold**");
		});

		it("leaves already-complete inline code unchanged", () => {
			expect(completeIncompleteMarkdown("`code`")).toBe("`code`");
		});

		it("does not count emphasis markers inside a complete inline-code span", () => {
			expect(completeIncompleteMarkdown("`a ** b` done")).toBe(
				"`a ** b` done",
			);
		});

		it("does not count several emphasis markers across multiple complete code spans", () => {
			expect(completeIncompleteMarkdown("`**` and `*` literal")).toBe(
				"`**` and `*` literal",
			);
		});

		it("does not treat underscores inside a complete inline-code span as emphasis", () => {
			expect(
				completeIncompleteMarkdown("text `code_with_underscores` more"),
			).toBe("text `code_with_underscores` more");
		});

		it("does not treat a bracket inside a complete inline-code span as a dangling link", () => {
			expect(completeIncompleteMarkdown("`[not a link]` after")).toBe(
				"`[not a link]` after",
			);
		});

		it("still closes real trailing emphasis after a complete inline-code span", () => {
			expect(completeIncompleteMarkdown("`code` then **bold")).toBe(
				"`code` then **bold**",
			);
		});

		it("leaves plain text unchanged", () => {
			expect(completeIncompleteMarkdown("normal text with no markers")).toBe(
				"normal text with no markers",
			);
		});

		it("does not treat a leading list-marker asterisk as italic", () => {
			expect(completeIncompleteMarkdown("* list item")).toBe("* list item");
		});

		it("does not touch a dash bullet list marker", () => {
			expect(completeIncompleteMarkdown("- bullet")).toBe("- bullet");
		});

		it("does not touch an ordered list marker", () => {
			expect(completeIncompleteMarkdown("1. item")).toBe("1. item");
		});

		it("does not treat intraword underscores as emphasis", () => {
			expect(completeIncompleteMarkdown("a_b_c")).toBe("a_b_c");
		});

		it("does not treat snake_case identifiers as emphasis", () => {
			expect(completeIncompleteMarkdown("snake_case_word")).toBe(
				"snake_case_word",
			);
		});

		it("does not treat a spaced multiplication asterisk as emphasis", () => {
			expect(completeIncompleteMarkdown("5 * 3 = 15")).toBe("5 * 3 = 15");
		});

		it("leaves a complete heading line unchanged", () => {
			expect(completeIncompleteMarkdown("# Heading")).toBe("# Heading");
		});

		it("returns an empty string unchanged", () => {
			expect(completeIncompleteMarkdown("")).toBe("");
		});
	});

	describe("idempotency", () => {
		const cases = [
			"**bold",
			"a **bold** and **more",
			"text `code",
			"text ``code with ` inside",
			"~~struck",
			"*italic",
			"[link text",
			"[link](http://ex",
			"```ts\nconst x = 1",
			"**bold**",
			"`code`",
			"normal text with no markers",
			"* list item",
			"5 * 3 = 15",
		];

		for (const input of cases) {
			it(`is idempotent for ${JSON.stringify(input)}`, () => {
				const once = completeIncompleteMarkdown(input);
				const twice = completeIncompleteMarkdown(once);
				expect(twice).toBe(once);
			});
		}
	});
});
