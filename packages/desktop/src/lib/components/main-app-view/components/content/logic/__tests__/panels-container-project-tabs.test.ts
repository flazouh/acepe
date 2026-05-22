import { describe, expect, it } from "bun:test";
import {
	buildPanelsContainerProjectTabs,
	shouldShowPanelsContainerProjectTabBar,
} from "../panels-container-project-tabs.js";

describe("panels container project tabs", () => {
	it("builds project tabs with session counts from groups", () => {
		const tabs = buildPanelsContainerProjectTabs({
			projects: [
				{ name: "App", color: "#111111", path: "/app", iconSrc: null },
				{ name: "Api", color: "#222222", path: "/api", iconSrc: "/api.svg" },
			],
			groups: [
				{ projectPath: "/app", agentPanels: [{ id: "a" }, { id: "b" }] },
				{ projectPath: "/other", agentPanels: [{ id: "c" }] },
			],
		});

		expect(tabs).toEqual([
			{
				name: "App",
				color: "#111111",
				path: "/app",
				iconSrc: null,
				sessionCount: 2,
			},
			{
				name: "Api",
				color: "#222222",
				path: "/api",
				iconSrc: "/api.svg",
				sessionCount: 0,
			},
		]);
	});

	it("shows the tab bar only for focused cards mode with multiple tabs", () => {
		expect(
			shouldShowPanelsContainerProjectTabBar({
				viewModeState: {
					layout: "cards",
					activeProjectPath: "/app",
					isFullscreenMode: false,
				},
				projectTabCount: 2,
			})
		).toBe(true);
	});

	it("hides the tab bar in multi, fullscreen, and single-tab states", () => {
		expect(
			shouldShowPanelsContainerProjectTabBar({
				viewModeState: {
					layout: "cards",
					activeProjectPath: null,
					isFullscreenMode: false,
				},
				projectTabCount: 2,
			})
		).toBe(false);
		expect(
			shouldShowPanelsContainerProjectTabBar({
				viewModeState: {
					layout: "fullscreen",
					activeProjectPath: "/app",
					isFullscreenMode: true,
				},
				projectTabCount: 2,
			})
		).toBe(false);
		expect(
			shouldShowPanelsContainerProjectTabBar({
				viewModeState: {
					layout: "cards",
					activeProjectPath: "/app",
					isFullscreenMode: false,
				},
				projectTabCount: 1,
			})
		).toBe(false);
	});
});
