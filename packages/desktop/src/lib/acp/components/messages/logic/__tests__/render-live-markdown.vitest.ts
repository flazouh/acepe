import { describe, expect, it } from "vitest";

import { renderLiveMarkdownSection } from "../render-live-markdown.js";

describe("renderLiveMarkdownSection", () => {
	it("renders a live paragraph with inline formatting", () => {
		const result = renderLiveMarkdownSection(
			{
				key: "LIVE:0",
				kind: "live-markdown",
				text: "**bold** and `code`",
				markdown: "**bold** and `code`",
				presentation: "paragraph",
				source: "**bold** and `code`",
			},
			{
				nowMs: (() => {
					let tick = 0;
					return () => {
						tick += 1;
						return tick;
					};
				})(),
			}
		);

		expect(result.durationMs).toBe(1);
		expect(result.html).toContain("<p>");
		expect(result.html).toContain("<strong>bold</strong>");
		expect(result.html).toContain("<code>code</code>");
	});

	it("renders safe links in a disabled visual state", () => {
		const result = renderLiveMarkdownSection(
			{
				key: "LIVE:0",
				kind: "live-markdown",
				text: "[Acepe](https://acepe.dev)",
				markdown: "[Acepe](https://acepe.dev)",
				presentation: "paragraph",
				source: "[Acepe](https://acepe.dev)",
			},
			{
				nowMs: (() => {
					let tick = 10;
					return () => {
						tick += 1;
						return tick;
					};
				})(),
			}
		);

		expect(result.html).toContain('class="streaming-live-link is-disabled"');
		expect(result.html).not.toContain("<a");
	});

	it("preserves non-1 ordered list starts during reveal", () => {
		const result = renderLiveMarkdownSection(
			{
				key: "LIVE:0",
				kind: "live-markdown",
				text: "3. third\n4. fourth",
				markdown: "3. third\n4. fourth",
				presentation: "list",
				source: "3. third\n4. fourth",
			},
			{
				nowMs: (() => {
					let tick = 15;
					return () => {
						tick += 1;
						return tick;
					};
				})(),
			}
		);

		expect(result.html).toContain('<ol start="3">');
		expect(result.html).toContain("<li>third</li>");
		expect(result.html).toContain("<li>fourth</li>");
	});

	it("renders a settled fenced code block without using the final renderer", () => {
		const result = renderLiveMarkdownSection(
			{
				key: "SETTLED:0",
				kind: "settled",
				markdown: "```ts\nconst answer = 42;\n```",
			},
			{
				nowMs: (() => {
					let tick = 20;
					return () => {
						tick += 1;
						return tick;
					};
				})(),
			}
		);

		expect(result.html).toContain("<pre");
		expect(result.html).toContain("<code");
		expect(result.html).toContain("const answer = 42;");
	});

	it("falls back for settled final-only placeholder output candidates", () => {
		const result = renderLiveMarkdownSection(
			{
				key: "SETTLED:0",
				kind: "settled",
				markdown: "```mermaid\ngraph TD;\n```",
			},
			{
				nowMs: (() => {
					let tick = 30;
					return () => {
						tick += 1;
						return tick;
					};
				})(),
			}
		);

		expect(result.html).toBeNull();
	});
});
