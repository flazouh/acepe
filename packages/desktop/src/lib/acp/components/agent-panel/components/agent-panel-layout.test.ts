import { describe, expect, it } from "vitest";

import {
	resolveAgentContentColumnStyle,
	resolveAgentPanelWidthStyle,
	shouldUseCenteredFullscreenContent,
} from "./agent-panel-layout.js";

describe("agent panel layout", () => {
	it("allows fullscreen panels to shrink inside split layouts", () => {
		expect(
			resolveAgentPanelWidthStyle({
				effectiveWidth: 900,
				isFullscreen: true,
			})
		).toBe("width: 100%; min-width: 0; max-width: 100%;");
	});

	it("keeps a fixed content column only outside fullscreen when an attached pane exists", () => {
		expect(
			resolveAgentContentColumnStyle({
				hasAttachedPane: true,
				isFullscreen: false,
				attachedColumnWidth: 450,
			})
		).toBe("min-width: 450px; width: 450px; max-width: 450px; flex: 0 0 450px;");

		expect(
			resolveAgentContentColumnStyle({
				hasAttachedPane: true,
				isFullscreen: true,
				attachedColumnWidth: 450,
			})
		).toBe("");
	});

	it("disables centered fullscreen content when an attached pane is open", () => {
		expect(
			shouldUseCenteredFullscreenContent({
				hasAttachedPane: false,
				isFullscreen: true,
			})
		).toBe(true);

		expect(
			shouldUseCenteredFullscreenContent({
				hasAttachedPane: true,
				isFullscreen: true,
			})
		).toBe(false);
	});
});
