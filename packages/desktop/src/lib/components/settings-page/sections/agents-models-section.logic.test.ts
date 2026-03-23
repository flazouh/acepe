import { describe, expect, it } from "bun:test";

import { applyAgentSelectionChange } from "./agents-models-section.logic.js";

describe("applyAgentSelectionChange", () => {
	it("returns unchanged state when callback repeats the current checked state", () => {
		const currentlySelected = ["claude-code", "cursor"];

		const result = applyAgentSelectionChange(currentlySelected, "claude-code", true);

		expect(result).toEqual({
			ok: true,
			changed: false,
			value: ["claude-code", "cursor"],
		});
	});

	it("removes an agent when checked changes from true to false", () => {
		const result = applyAgentSelectionChange(["claude-code", "cursor"], "cursor", false);

		expect(result).toEqual({
			ok: true,
			changed: true,
			value: ["claude-code"],
		});
	});

	it("adds an agent when checked changes from false to true", () => {
		const result = applyAgentSelectionChange(["claude-code"], "cursor", true);

		expect(result).toEqual({
			ok: true,
			changed: true,
			value: ["claude-code", "cursor"],
		});
	});

	it("blocks unchecking the final selected agent", () => {
		const result = applyAgentSelectionChange(["claude-code"], "claude-code", false);

		expect(result).toEqual({
			ok: false,
			error: "At least one agent must remain selected",
		});
	});
});
