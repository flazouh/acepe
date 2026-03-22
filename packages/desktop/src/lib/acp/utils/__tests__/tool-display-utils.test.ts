import { describe, expect, it } from "bun:test";

import type { LastToolInfo } from "../../components/session-list/session-list-types.js";

import { getToolDisplayState } from "../tool-display-utils.js";

describe("getToolDisplayState", () => {
	const readTool: LastToolInfo = { name: "Read", target: "file.ts", kind: "read" };
	const editTool: LastToolInfo = { name: "Edit", target: "file.ts", kind: "edit" };

	it("should return current when currentTool exists", () => {
		const result = getToolDisplayState(readTool, null);
		expect(result).toEqual({ type: "current", tool: readTool });
	});

	it("should prioritize currentTool over lastTool", () => {
		const result = getToolDisplayState(readTool, editTool);
		expect(result).toEqual({ type: "current", tool: readTool });
	});

	it("should fall back to lastTool when no currentTool exists", () => {
		const result = getToolDisplayState(null, editTool);
		expect(result).toEqual({ type: "current", tool: editTool });
	});

	it("should return idle when no tools exist", () => {
		const result = getToolDisplayState(null, null);
		expect(result).toEqual({ type: "idle" });
	});
});
