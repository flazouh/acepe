import { describe, expect, it } from "bun:test";

import { getMicButtonAccessibleDescription } from "./agent-input-mic-button-state.js";

describe("agent input mic button state", () => {
	it("joins the label and hold key into one accessible description", () => {
		expect(getMicButtonAccessibleDescription("Start voice recording", ["⌥"])).toBe(
			"Start voice recording ⌥"
		);
	});

	it("keeps the label only when there is no hold key", () => {
		expect(getMicButtonAccessibleDescription("Downloading speech model…", [])).toBe(
			"Downloading speech model…"
		);
	});
});
