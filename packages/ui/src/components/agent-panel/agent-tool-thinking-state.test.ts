import { describe, expect, test } from "bun:test";
import {
	getNextThinkingCollapsed,
	getThinkingCollapseLabel,
	getThinkingPreferenceState,
	hasThinkingContent,
} from "./agent-tool-thinking-state.js";

describe("agent tool thinking state", () => {
	test("detects whether thinking content exists", () => {
		expect(hasThinkingContent(true)).toBe(true);
		expect(hasThinkingContent(false)).toBe(false);
	});

	test("flips collapsed state", () => {
		expect(getNextThinkingCollapsed(true)).toBe(false);
		expect(getNextThinkingCollapsed(false)).toBe(true);
	});

	test("chooses collapse button aria label", () => {
		expect(
			getThinkingCollapseLabel({
				collapsed: true,
				ariaExpandLabel: "Expand thinking",
				ariaCollapseLabel: "Collapse thinking",
			})
		).toBe("Expand thinking");
		expect(
			getThinkingCollapseLabel({
				collapsed: false,
				ariaExpandLabel: "Expand thinking",
				ariaCollapseLabel: "Collapse thinking",
			})
		).toBe("Collapse thinking");
	});

	test("uses explicit default preference before context preference", () => {
		const state = getThinkingPreferenceState({
			defaultExpanded: false,
			contextDefaultExpanded: true,
		});

		expect(state.defaultExpanded).toBe(false);
		expect(state.defaultExpandLabel).toBe("Expand thinking by default");
		expect(state.defaultExpandIconWeight).toBe("regular");
		expect(state.defaultExpandClass).toBe("text-muted-foreground");
	});

	test("falls back to context default preference", () => {
		const state = getThinkingPreferenceState({
			contextDefaultExpanded: true,
		});

		expect(state.defaultExpanded).toBe(true);
		expect(state.defaultExpandLabel).toBe("Collapse thinking by default");
		expect(state.defaultExpandIconWeight).toBe("fill");
		expect(state.defaultExpandClass).toBe("text-foreground");
	});

	test("uses explicit toggle callback before context callback", () => {
		const explicitToggle = () => {};
		const contextToggle = () => {};

		expect(
			getThinkingPreferenceState({
				onToggleDefaultExpand: explicitToggle,
				contextToggleDefaultExpand: contextToggle,
			}).onToggleDefaultExpand
		).toBe(explicitToggle);
		expect(
			getThinkingPreferenceState({
				contextToggleDefaultExpand: contextToggle,
			}).onToggleDefaultExpand
		).toBe(contextToggle);
	});
});
