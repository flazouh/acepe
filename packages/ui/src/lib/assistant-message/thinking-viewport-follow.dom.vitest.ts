import { describe, expect, it, vi } from "vitest";

import { scrollTailToVisibleEnd } from "./thinking-viewport-follow.js";

describe("scrollTailToVisibleEnd", () => {
	it("keeps thinking follow inside its own scroll container", () => {
		const container = document.createElement("div");
		const contentRoot = document.createElement("div");
		const markdownRoot = document.createElement("div");
		const paragraph = document.createElement("p");
		markdownRoot.className = "markdown-content";
		markdownRoot.appendChild(paragraph);
		contentRoot.appendChild(markdownRoot);
		container.appendChild(contentRoot);

		Object.defineProperty(container, "scrollHeight", { value: 120, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 40, configurable: true });
		const scrollIntoView = vi.spyOn(paragraph, "scrollIntoView");

		scrollTailToVisibleEnd(container);

		expect(container.scrollTop).toBe(80);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
