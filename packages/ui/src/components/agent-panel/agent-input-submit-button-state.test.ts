import { describe, expect, it } from "bun:test";

import {
	getSubmitButtonAccessibleDescription,
	getSubmitButtonIconName,
	getSubmitButtonTooltipRows,
} from "./agent-input-submit-button-state.js";

const tooltipCopy = {
	stopLabel: "Stop",
	steerLabel: "Steer",
	steerDescription: "Interrupts now and redirects the agent immediately.",
	steerShortcut: "Enter",
	queueLabel: "Queue",
	queueDescription: "Runs after the agent finishes its current turn.",
	queueShortcut: "⌘Enter",
};

describe("agent input submit button state", () => {
	it("uses ArrowUp02 for send", () => {
		expect(getSubmitButtonIconName("send")).toBe("arrow-up-02");
	});

	it("uses stop only for the interrupt button", () => {
		expect(getSubmitButtonIconName("stop")).toBe("stop");
		expect(getSubmitButtonIconName("steer")).toBe("arrow-up-02");
	});

	it("explains steer and queue shortcuts on the send tooltip", () => {
		expect(getSubmitButtonTooltipRows("send", tooltipCopy)).toEqual([
			{
				label: "Steer",
				description: "Interrupts now and redirects the agent immediately.",
				shortcut: "Enter",
			},
			{
				label: "Queue",
				description: "Runs after the agent finishes its current turn.",
				shortcut: "⌘Enter",
			},
		]);
	});

	it("keeps the stop tooltip on the interrupt button", () => {
		expect(getSubmitButtonTooltipRows("stop", tooltipCopy)).toEqual([
			{
				label: "Stop",
				description: "",
				shortcut: "",
			},
		]);
	});

	it("joins steer and queue copy into one accessible description", () => {
		expect(
			getSubmitButtonAccessibleDescription(getSubmitButtonTooltipRows("send", tooltipCopy))
		).toBe(
			"Steer: Interrupts now and redirects the agent immediately. Enter Queue: Runs after the agent finishes its current turn. ⌘Enter"
		);
	});
});
