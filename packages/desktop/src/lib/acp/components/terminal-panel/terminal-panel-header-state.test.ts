import { describe, expect, it } from "bun:test";
import type { TerminalTab } from "$lib/acp/store/types.js";
import {
	canShowCloseTerminalTabAction,
	canShowMoveTerminalTabAction,
	canShowTerminalTabMenu,
	getNextOpenTerminalTabMenuId,
	getTerminalProjectBadgeColor,
	getTerminalShellName,
	getTerminalTabLabel,
	hasTerminalTabs,
	shouldShowTerminalFullscreenAction,
} from "./terminal-panel-header-state.js";

function makeTab(id: string): TerminalTab {
	return {
		id,
		groupId: "group-1",
		projectPath: "/repo",
		createdAt: 1,
		ptyId: null,
		shell: "/bin/zsh",
	};
}

describe("terminal panel header state", () => {
	it("normalizes the optional project badge color", () => {
		expect(getTerminalProjectBadgeColor("#123456")).toBe("#123456");
		expect(getTerminalProjectBadgeColor(undefined)).toBe("");
	});

	it("extracts a readable shell name", () => {
		expect(getTerminalShellName("/bin/zsh")).toBe("zsh");
		expect(getTerminalShellName("fish")).toBe("fish");
		expect(getTerminalShellName(null)).toBeNull();
		expect(getTerminalShellName("")).toBeNull();
	});

	it("builds terminal tab labels from zero-based indexes", () => {
		expect(getTerminalTabLabel(0)).toBe("Terminal 1");
		expect(getTerminalTabLabel(2)).toBe("Terminal 3");
	});

	it("shows fullscreen when either fullscreen callback exists", () => {
		expect(
			shouldShowTerminalFullscreenAction({
				onEnterFullscreen: undefined,
				onExitFullscreen: undefined,
			})
		).toBe(false);
		expect(
			shouldShowTerminalFullscreenAction({
				onEnterFullscreen: () => undefined,
				onExitFullscreen: undefined,
			})
		).toBe(true);
		expect(
			shouldShowTerminalFullscreenAction({
				onEnterFullscreen: undefined,
				onExitFullscreen: () => undefined,
			})
		).toBe(true);
	});

	it("detects terminal tab availability", () => {
		expect(hasTerminalTabs(undefined)).toBe(false);
		expect(hasTerminalTabs([])).toBe(false);
		expect(hasTerminalTabs([makeTab("tab-1")])).toBe(true);
	});

	it("shows a tab menu when at least one tab action exists", () => {
		const tabs = [makeTab("tab-1")];

		expect(
			canShowTerminalTabMenu({
				tabs,
				onCloseTab: undefined,
				onMoveTabToNewPanel: undefined,
			})
		).toBe(false);
		expect(
			canShowTerminalTabMenu({
				tabs,
				onCloseTab: () => undefined,
				onMoveTabToNewPanel: undefined,
			})
		).toBe(true);
		expect(
			canShowTerminalTabMenu({
				tabs: undefined,
				onCloseTab: () => undefined,
				onMoveTabToNewPanel: undefined,
			})
		).toBe(false);
	});

	it("shows move action only for movable tabs in multi-tab panels", () => {
		const tabs = [makeTab("tab-1"), makeTab("tab-2")];

		expect(
			canShowMoveTerminalTabAction({
				tabId: "tab-1",
				tabs,
				onMoveTabToNewPanel: () => undefined,
				canMoveTabToNewPanel: (id) => id === "tab-1",
			})
		).toBe(true);
		expect(
			canShowMoveTerminalTabAction({
				tabId: "tab-2",
				tabs,
				onMoveTabToNewPanel: () => undefined,
				canMoveTabToNewPanel: (id) => id === "tab-1",
			})
		).toBe(false);
		expect(
			canShowMoveTerminalTabAction({
				tabId: "tab-1",
				tabs: [makeTab("tab-1")],
				onMoveTabToNewPanel: () => undefined,
				canMoveTabToNewPanel: () => true,
			})
		).toBe(false);
	});

	it("shows close action only when there is more than one tab", () => {
		expect(
			canShowCloseTerminalTabAction({
				tabs: [makeTab("tab-1"), makeTab("tab-2")],
				onCloseTab: () => undefined,
			})
		).toBe(true);
		expect(
			canShowCloseTerminalTabAction({
				tabs: [makeTab("tab-1")],
				onCloseTab: () => undefined,
			})
		).toBe(false);
		expect(
			canShowCloseTerminalTabAction({
				tabs: [makeTab("tab-1"), makeTab("tab-2")],
				onCloseTab: undefined,
			})
		).toBe(false);
	});

	it("toggles the open tab menu id", () => {
		expect(getNextOpenTerminalTabMenuId({ openMenuTabId: null, tabId: "tab-1" })).toBe("tab-1");
		expect(getNextOpenTerminalTabMenuId({ openMenuTabId: "tab-1", tabId: "tab-1" })).toBeNull();
		expect(getNextOpenTerminalTabMenuId({ openMenuTabId: "tab-2", tabId: "tab-1" })).toBe("tab-1");
	});
});
