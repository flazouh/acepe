import { describe, expect, it } from "vitest";

import { canCancelVoiceInteraction, shouldShowVoiceOverlay } from "../voice-ui-state.js";

describe("voice-ui-state", () => {
	it("allows Escape/cancel affordances while transcribing", () => {
		expect(canCancelVoiceInteraction("transcribing")).toBe(true);
	});

	it("keeps the overlay visible during error states", () => {
		expect(shouldShowVoiceOverlay("error")).toBe(true);
	});

	it("does not show the overlay when voice is idle", () => {
		expect(shouldShowVoiceOverlay("idle")).toBe(false);
	});
});