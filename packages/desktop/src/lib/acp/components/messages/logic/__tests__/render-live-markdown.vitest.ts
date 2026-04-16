import { describe, expect, it } from "vitest";

import { renderLiveMarkdownSection } from "../render-live-markdown.js";

function countWordFadeSpans(html: string | null): number {
	return html === null ? 0 : Array.from(html.matchAll(/class="sd-word-fade"/g)).length;
}

describe("renderLiveMarkdownSection", () => {
	it("renders a live paragraph with inline formatting", () => {
		const result = renderLiveMarkdownSection({
			key: "LIVE:0",
			kind: "live-markdown",
			text: "**bold** and `code`",
			markdown: "**bold** and `code`",
			presentation: "paragraph",
			source: "**bold** and `code`",
		});

		expect(result.html).toContain("<p>");
		expect(result.html).toContain("<strong>bold</strong>");
		expect(result.html).toContain("<code>code</code>");
	});

	it("renders safe links in a disabled visual state", () => {
		const result = renderLiveMarkdownSection({
			key: "LIVE:0",
			kind: "live-markdown",
			text: "[Acepe](https://acepe.dev)",
			markdown: "[Acepe](https://acepe.dev)",
			presentation: "paragraph",
			source: "[Acepe](https://acepe.dev)",
		});

		expect(result.html).toContain('class="streaming-live-link is-disabled"');
		expect(result.html).not.toContain("<a");
	});

	it("preserves non-1 ordered list starts during reveal", () => {
		const result = renderLiveMarkdownSection({
			key: "LIVE:0",
			kind: "live-markdown",
			text: "3. third\n4. fourth",
			markdown: "3. third\n4. fourth",
			presentation: "list",
			source: "3. third\n4. fourth",
		});

		expect(result.html).toContain('<ol start="3">');
		expect(result.html).toContain("<li>third</li>");
		expect(result.html).toContain("<li>fourth</li>");
	});

	it("renders a settled fenced code block without using the final renderer", () => {
		const result = renderLiveMarkdownSection({
			key: "SETTLED:0",
			kind: "settled",
			markdown: "```ts\nconst answer = 42;\n```",
		});

		expect(result.html).toContain("<pre");
		expect(result.html).toContain("<code");
		expect(result.html).toContain("const answer = 42;");
	});

	it("falls back for settled final-only placeholder output candidates", () => {
		const result = renderLiveMarkdownSection({
			key: "SETTLED:0",
			kind: "settled",
			markdown: "```mermaid\ngraph TD;\n```",
		});

		expect(result.html).toBeNull();
	});

	describe("animate: true", () => {
		it("wraps words in sd-word-fade spans for a paragraph", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "hello world",
					markdown: "hello world",
					presentation: "paragraph",
					source: "hello world",
				},
				{ animate: true }
			);

			expect(result.html).toContain('class="sd-word-fade"');
			expect(result.html).toContain("hello");
			expect(result.html).toContain("world");
		});

		it("does not wrap words when animate is false (instant mode)", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "hello world",
					markdown: "hello world",
					presentation: "paragraph",
					source: "hello world",
				},
				{ animate: false }
			);

			expect(result.html).not.toContain('class="sd-word-fade"');
		});

		it("wraps inline code token as a whole unit (not word-split inside code)", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "use `console.log` here",
					markdown: "use `console.log` here",
					presentation: "paragraph",
					source: "use `console.log` here",
				},
				{ animate: true }
			);

			// The <code> block should be wrapped by a single sd-word-fade span
			expect(result.html).toContain('class="sd-word-fade"><code>console.log</code>');
			// The text inside <code> should not itself be wrapped in sd-word-fade spans
			expect(result.html).not.toContain("<code><span");
			expect(result.html).not.toContain('class="sd-word-fade"><span class="sd-word-fade"');
			expect(countWordFadeSpans(result.html)).toBe(3);
		});

		it("wraps bold text as a whole unit", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "**bold text**",
					markdown: "**bold text**",
					presentation: "paragraph",
					source: "**bold text**",
				},
				{ animate: true }
			);

			expect(result.html).toContain('class="sd-word-fade"><strong>bold text</strong>');
			expect(result.html).not.toContain('class="sd-word-fade"><span class="sd-word-fade"');
			expect(countWordFadeSpans(result.html)).toBe(1);
		});

		it("wraps disabled links as a whole unit without nesting fade spans", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "[Acepe](https://acepe.dev)",
					markdown: "[Acepe](https://acepe.dev)",
					presentation: "paragraph",
					source: "[Acepe](https://acepe.dev)",
				},
				{ animate: true }
			);

			expect(result.html).toContain(
				'class="sd-word-fade"><span class="streaming-live-link is-disabled" data-streaming-link-state="disabled">Acepe</span>'
			);
			expect(result.html).not.toContain('class="sd-word-fade"><span class="sd-word-fade"');
			expect(countWordFadeSpans(result.html)).toBe(1);
		});

		it("wraps heading words in fade spans", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "# Hello World",
					markdown: "# Hello World",
					presentation: "heading",
					source: "# Hello World",
				},
				{ animate: true }
			);

			expect(result.html).toContain("<h1>");
			expect(result.html).toContain('class="sd-word-fade"');
		});

		it("wraps list item words in fade spans", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "LIVE:0",
					kind: "live-markdown",
					text: "- item one\n- item two",
					markdown: "- item one\n- item two",
					presentation: "list",
					source: "- item one\n- item two",
				},
				{ animate: true }
			);

			expect(result.html).toContain("<ul>");
			expect(result.html).toContain('class="sd-word-fade"');
		});

		it("applies block-level fade class to settled fenced code blocks", () => {
			const result = renderLiveMarkdownSection(
				{
					key: "SETTLED:0",
					kind: "settled",
					markdown: "```ts\nconst x = 1;\n```",
				},
				{ animate: true }
			);

			expect(result.html).toContain("sd-word-fade");
			expect(result.html).toContain("<pre");
			// Should not have per-word spans inside the code
			expect(result.html).not.toContain("<span");
		});
	});
});
