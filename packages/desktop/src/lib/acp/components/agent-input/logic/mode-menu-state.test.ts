import { describe, expect, it } from "bun:test";

import { resolveModeMenuAction, resolveSelectedModeMenuOptionId } from "./mode-menu-state.js";

describe("mode-menu-state", () => {
	it("keeps the provider mode selected when autonomous is enabled", () => {
		expect(
			resolveSelectedModeMenuOptionId({
				currentModeId: "agent",
				autonomousEnabled: true,
			})
		).toBe("agent");
	});

	it("keeps the canonical mode selected when autonomous is off", () => {
		expect(
			resolveSelectedModeMenuOptionId({
				currentModeId: "plan",
				autonomousEnabled: false,
			})
		).toBe("plan");
	});

	it("turns autonomous off when a mode is chosen while autonomous is on", () => {
		expect(
			resolveModeMenuAction({
				selectedOptionId: "agent",
				currentModeId: "agent",
				autonomousEnabled: true,
			})
		).toEqual({
			modeIdToApply: null,
			autonomousEnabledToApply: false,
		});
	});

	it("changes to plan and turns autonomous off when needed", () => {
		expect(
			resolveModeMenuAction({
				selectedOptionId: "plan",
				currentModeId: "agent",
				autonomousEnabled: true,
			})
		).toEqual({
			modeIdToApply: "plan",
			autonomousEnabledToApply: false,
		});
	});
});
