import { describe, expect, it } from "bun:test";

import {
	buildStructuredNodeDisplayState,
	getStructuredNodeDisplayValue,
	getStructuredNodeKeyPrefix,
	getStructuredPrimitiveStyle,
} from "./file-panel-structured-node-state.js";

describe("file-panel-structured-node-state", () => {
	it("builds expandable object state", () => {
		const state = buildStructuredNodeDisplayState({
			value: { name: "Codex", ready: true },
			label: "agent",
			depth: 2,
		});

		expect(state.isContainer).toBe(true);
		expect(state.isArray).toBe(false);
		expect(state.isExpandable).toBe(true);
		expect(state.containerSummary).toBe("Object(2)");
		expect(state.entries.map((entry) => entry.key)).toEqual(["name", "ready"]);
		expect(state.keyPrefix).toBe("agent");
		expect(state.leftPadding).toBe("24px");
		expect(state.primitiveStyle).toBe("");
	});

	it("builds array state with index label formatting", () => {
		const state = buildStructuredNodeDisplayState({
			value: ["one", "two"],
			label: "0",
			depth: 1,
		});

		expect(state.isContainer).toBe(true);
		expect(state.isArray).toBe(true);
		expect(state.isExpandable).toBe(true);
		expect(state.containerSummary).toBe("Array(2)");
		expect(state.keyPrefix).toBe("[0]");
		expect(state.leftPadding).toBe("12px");
	});

	it("parses stringified containers for nested display", () => {
		const state = buildStructuredNodeDisplayState({
			value: '{"mode":"fast","count":2}',
			label: null,
			depth: 0,
		});

		expect(state.displayValue).toEqual({ mode: "fast", count: 2 });
		expect(state.isContainer).toBe(true);
		expect(state.containerSummary).toBe("Object(2)");
		expect(state.keyPrefix).toBe("root");
	});

	it("keeps normal strings as primitive display values", () => {
		expect(getStructuredNodeDisplayValue("hello")).toBe("hello");
	});

	it("formats key prefixes", () => {
		expect(getStructuredNodeKeyPrefix(null)).toBe("root");
		expect(getStructuredNodeKeyPrefix("7")).toBe("[7]");
		expect(getStructuredNodeKeyPrefix("title")).toBe("title");
	});

	it("returns primitive color styles", () => {
		expect(getStructuredPrimitiveStyle(null)).toContain("color:");
		expect(getStructuredPrimitiveStyle(true)).toContain("color:");
		expect(getStructuredPrimitiveStyle(42)).toContain("color:");
		expect(getStructuredPrimitiveStyle("hello")).toBe("color: var(--success)");
		expect(getStructuredPrimitiveStyle({ nested: true })).toBe("");
	});
});
