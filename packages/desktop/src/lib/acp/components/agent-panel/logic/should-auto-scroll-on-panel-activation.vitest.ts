import { describe, expect, it } from "vitest";

import { shouldAutoScrollOnPanelActivation } from "./should-auto-scroll-on-panel-activation.js";

describe("shouldAutoScrollOnPanelActivation", () => {
	it("does not auto-scroll on the initial panel activation", () => {
		expect(
			shouldAutoScrollOnPanelActivation({
				currentPanelId: "panel-1",
				previousPanelId: undefined,
			})
		).toBe(false);
	});

	it("does not auto-scroll when the panel stays active", () => {
		expect(
			shouldAutoScrollOnPanelActivation({
				currentPanelId: "panel-1",
				previousPanelId: "panel-1",
			})
		).toBe(false);
	});

	it("auto-scrolls when the user switches to a different panel", () => {
		expect(
			shouldAutoScrollOnPanelActivation({
				currentPanelId: "panel-2",
				previousPanelId: "panel-1",
			})
		).toBe(true);
	});
});
