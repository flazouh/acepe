import { describe, expect, it } from "bun:test";

import {
	acepeStreamdownUrlTransform,
	createAcepeStreamdownConfig,
} from "./streamdown-config.js";

describe("createAcepeStreamdownConfig", () => {
	it("enables streaming parsing and animation for smooth streaming content", () => {
		const config = createAcepeStreamdownConfig({
			phase: "streaming",
			streamingAnimationMode: "smooth",
		});

		expect(config.mode).toBe("streaming");
		expect(config.parseIncompleteMarkdown).toBe(true);
		expect(config.animated).toEqual({
			animation: "acepeTokenReveal",
			duration: 630,
			easing: "cubic-bezier(0.16, 1, 0.3, 1)",
			sep: "word",
			stagger: 0,
		});
		expect(config.remend).toEqual({});
	});

	it("uses static non-animated rendering for settled history", () => {
		const config = createAcepeStreamdownConfig({
			phase: "settled",
			streamingAnimationMode: "smooth",
		});

		expect(config.mode).toBe("static");
		expect(config.parseIncompleteMarkdown).toBe(false);
		expect(config.animated).toBe(false);
	});

	it("disables animation for instant streaming without disabling markdown parsing", () => {
		const config = createAcepeStreamdownConfig({
			phase: "streaming",
			streamingAnimationMode: "instant",
		});

		expect(config.mode).toBe("streaming");
		expect(config.parseIncompleteMarkdown).toBe(true);
		expect(config.animated).toBe(false);
	});
});

describe("acepeStreamdownUrlTransform", () => {
	it("blocks unsafe model-authored URL protocols", () => {
		const unsafeUrls = [
			"javascript:alert(1)",
			"data:text/html,<script></script>",
			"file:///etc/passwd",
			"blob:https://example.com/id",
			"vbscript:msgbox(1)",
		];

		for (const unsafeUrl of unsafeUrls) {
			expect(acepeStreamdownUrlTransform(unsafeUrl, "href", { type: "element", tagName: "a", properties: {}, children: [] })).toBeNull();
		}
	});

	it("delegates safe http URLs to Streamdown's default transform", () => {
		expect(
			acepeStreamdownUrlTransform("https://example.com", "href", {
				type: "element",
				tagName: "a",
				properties: {},
				children: [],
			})
		).toBe("https://example.com");
	});

	it("allows relative local links for host-routed file chips", () => {
		expect(
			acepeStreamdownUrlTransform("src/app.ts#L12", "href", {
				type: "element",
				tagName: "a",
				properties: {},
				children: [],
			})
		).toBe("src/app.ts#L12");
	});
});
