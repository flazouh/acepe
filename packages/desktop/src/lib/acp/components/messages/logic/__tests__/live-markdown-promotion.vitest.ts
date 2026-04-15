import { describe, expect, it } from "vitest";

import { promoteLiveMarkdownText } from "../live-markdown-promotion.js";

describe("promoteLiveMarkdownText", () => {
	it("promotes a plain paragraph to live markdown", () => {
		expect(promoteLiveMarkdownText("Hello world")).toEqual({
			markdown: "Hello world",
			presentation: "paragraph",
		});
	});

	it("promotes a heading to live markdown", () => {
		expect(promoteLiveMarkdownText("## Shipping plan")).toEqual({
			markdown: "## Shipping plan",
			presentation: "heading",
		});
	});

	it("promotes blockquote lines when all revealed lines are quoted", () => {
		expect(promoteLiveMarkdownText("> quoted\n> still quoted")).toEqual({
			markdown: "> quoted\n> still quoted",
			presentation: "blockquote",
		});
	});

	it("promotes closed safe markdown links", () => {
		expect(promoteLiveMarkdownText("[Acepe](https://acepe.dev)")).toEqual({
			markdown: "[Acepe](https://acepe.dev)",
			presentation: "paragraph",
		});
	});

	it("keeps partial or disallowed links on the fallback path", () => {
		expect(promoteLiveMarkdownText("[Acepe](https://acepe.dev")).toBeNull();
		expect(promoteLiveMarkdownText("[bad](javascript:alert(1))")).toBeNull();
	});

	it("keeps task-list syntax on the fallback path", () => {
		expect(promoteLiveMarkdownText("- [ ] pending")).toBeNull();
		expect(promoteLiveMarkdownText("- [x] done")).toBeNull();
	});

	it("keeps mixed ordered and unordered list markers on the fallback path", () => {
		expect(promoteLiveMarkdownText("1. one\n- two")).toBeNull();
	});

	it("keeps ambiguous inline markers on the fallback path", () => {
		expect(promoteLiveMarkdownText("**bold")).toBeNull();
		expect(promoteLiveMarkdownText("`snippet")).toBeNull();
	});

	it("keeps raw html-like content on the fallback path", () => {
		expect(promoteLiveMarkdownText("<script>alert(1)</script>")).toBeNull();
	});
});
