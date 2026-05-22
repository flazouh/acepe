import { describe, expect, it } from "bun:test";

import {
	areStructuredPathsEqual,
	buildStructuredNavNodeDisplayState,
	getStructuredNavNodeLabel,
	getStructuredNavNodeLeftPadding,
} from "./file-panel-structured-nav-node-state.js";

describe("file-panel-structured-nav-node-state", () => {
	it("builds expandable selected state for object nodes", () => {
		const state = buildStructuredNavNodeDisplayState({
			value: { name: "Codex", ready: true },
			label: "agent",
			depth: 2,
			currentPath: ["agents", "0"],
			selectedPath: ["agents", "0"],
		});

		expect(state.isContainer).toBe(true);
		expect(state.isExpandable).toBe(true);
		expect(state.isSelected).toBe(true);
		expect(state.entries.map((entry) => entry.key)).toEqual(["name", "ready"]);
		expect(state.displayLabel).toBe("agent");
		expect(state.leftPadding).toBe("32px");
	});

	it("builds non-expandable unselected state for primitives", () => {
		const state = buildStructuredNavNodeDisplayState({
			value: "hello",
			label: "title",
			depth: 0,
			currentPath: ["title"],
			selectedPath: ["other"],
		});

		expect(state.isContainer).toBe(false);
		expect(state.isExpandable).toBe(false);
		expect(state.isSelected).toBe(false);
		expect(state.entries).toEqual([]);
		expect(state.displayLabel).toBe("title");
		expect(state.leftPadding).toBe("8px");
	});

	it("formats nav labels", () => {
		expect(getStructuredNavNodeLabel(null)).toBe("/");
		expect(getStructuredNavNodeLabel("3")).toBe("[3]");
		expect(getStructuredNavNodeLabel("settings")).toBe("settings");
	});

	it("compares paths by length and segment values", () => {
		expect(areStructuredPathsEqual(["a", "b"], ["a", "b"])).toBe(true);
		expect(areStructuredPathsEqual(["a"], ["a", "b"])).toBe(false);
		expect(areStructuredPathsEqual(["a", "c"], ["a", "b"])).toBe(false);
	});

	it("builds left padding from depth", () => {
		expect(getStructuredNavNodeLeftPadding(0)).toBe("8px");
		expect(getStructuredNavNodeLeftPadding(3)).toBe("44px");
	});
});
