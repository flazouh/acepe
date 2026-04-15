import { describe, expect, it } from "bun:test";

import {
	MODE_MENU_OPTION_ID,
	resolveModeMenuAction,
	resolveSelectedModeMenuOptionId,
} from "./mode-menu-state.js";

describe("mode-menu-state", () => {
	it("reports auto as the selected option when autonomous is enabled", () => {
		expect(
			resolveSelectedModeMenuOptionId({
				currentModeId: "build",
				autonomousEnabled: true,
			})
		).toBe(MODE_MENU_OPTION_ID.AUTO);
	});

	it("keeps the canonical mode selected when autonomous is off", () => {
		expect(
			resolveSelectedModeMenuOptionId({
				currentModeId: "plan",
				autonomousEnabled: false,
			})
		).toBe("plan");
	});

	it("switches to build and enables autonomous when auto is chosen", () => {
		expect(
			resolveModeMenuAction({
				selectedOptionId: MODE_MENU_OPTION_ID.AUTO,
				currentModeId: "plan",
				autonomousEnabled: false,
				buildModeId: "build",
			})
		).toEqual({
			modeIdToApply: "build",
			autonomousEnabledToApply: true,
		});
	});

	it("turns autonomous off when build is chosen from auto", () => {
		expect(
			resolveModeMenuAction({
				selectedOptionId: "build",
				currentModeId: "build",
				autonomousEnabled: true,
				buildModeId: "build",
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
				currentModeId: "build",
				autonomousEnabled: true,
				buildModeId: "build",
			})
		).toEqual({
			modeIdToApply: "plan",
			autonomousEnabledToApply: false,
		});
	});
});
