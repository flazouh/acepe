import { describe, expect, it } from "bun:test";

import {
	getSubmitButtonAccessibleDescription,
	getSubmitButtonIconName,
	getSubmitButtonTooltipRows,
} from "./agent-input-submit-button-state.js";

const tooltipCopy = {
	stopLabel: "Stop",
	steerLabel: "Steer",
	steerShortcut: ["Enter"],
	queueLabel: "Queue",
	queueShortcut: ["⌘", "Enter"],
};

describe("agent input submit button state", () => {
	it("uses ArrowUp02 for send", () => {
		expect(getSubmitButtonIconName("send")).toBe("arrow-up-02");
	});

	it("uses stop only for the interrupt button", () => {
		expect(getSubmitButtonIconName("stop")).toBe("stop");
		expect(getSubmitButtonIconName("steer")).toBe("arrow-up-02");
	});

	it("lists steer and queue labels with key tokens", () => {
		expect(getSubmitButtonTooltipRows("send", tooltipCopy)).toEqual([
			{
				label: "Steer",
				shortcut: ["Enter"],
			},
			{
				label: "Queue",
				shortcut: ["⌘", "Enter"],
			},
		]);
	});

	it("keeps the stop tooltip on the interrupt button", () => {
		expect(getSubmitButtonTooltipRows("stop", tooltipCopy)).toEqual([
			{
				label: "Stop",
				shortcut: [],
			},
		]);
	});

	it("joins labels and keys into one accessible description", () => {
		expect(
			getSubmitButtonAccessibleDescription(getSubmitButtonTooltipRows("send", tooltipCopy))
		).toBe("Steer Enter Queue ⌘ Enter");
	});
});
