import { describe, expect, it } from "bun:test";

import {
	clampVisibleLineCount,
	DEFAULT_THINKING_VIEWPORT_POLICY,
	thinkingViewportCssText,
} from "../thinking-viewport-policy.js";

describe("thinkingViewportPolicy", () => {
	it("default policy matches previous assistant-message constants", () => {
		expect(DEFAULT_THINKING_VIEWPORT_POLICY.visibleLineCount).toBe(3);
		expect(DEFAULT_THINKING_VIEWPORT_POLICY.lineHeightRem).toBe(1);
	});

	it("thinkingViewportCssText emits variables for style binding", () => {
		const css = thinkingViewportCssText(DEFAULT_THINKING_VIEWPORT_POLICY);
		expect(css).toContain("--thinking-visible-lines:3");
		expect(css).toContain("--thinking-line-height:1rem");
	});

	it("clampVisibleLineCount floors and enforces minimum 1", () => {
		expect(clampVisibleLineCount(1)).toBe(1);
		expect(clampVisibleLineCount(1.9)).toBe(1);
		expect(clampVisibleLineCount(NaN)).toBe(3);
	});
});
