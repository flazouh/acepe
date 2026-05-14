import { describe, expect, it } from "bun:test";

import { shouldHideAgentPanelProjectBadge } from "./panel-project-badge-visibility.js";

describe("shouldHideAgentPanelProjectBadge", () => {
	it("keeps project badges visible in focused project view", () => {
		expect(
			shouldHideAgentPanelProjectBadge({
				groupCount: 2,
				isMultiCardsMode: false,
			})
		).toBe(false);
	});

	it("keeps project badges visible in multi-project card view", () => {
		expect(
			shouldHideAgentPanelProjectBadge({
				groupCount: 2,
				isMultiCardsMode: true,
			})
		).toBe(false);
	});
});
