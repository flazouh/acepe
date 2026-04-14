/**
 * View mode state tests – getViewModeState() semantics for single/project/multi.
 */

import { describe, expect, it } from "vitest";

import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";

import { getViewModeState } from "../view-mode-state.js";

function createMockPanelStore(overrides: {
	viewMode?: "single" | "project" | "multi" | "kanban";
	fullscreenPanelId?: string | null;
	focusedPanelId?: string | null;
	focusedViewProjectPath?: string | null;
}): PanelStore {
	return {
		viewMode: overrides.viewMode ?? "multi",
		fullscreenPanelId: overrides.fullscreenPanelId ?? null,
		focusedPanelId: overrides.focusedPanelId ?? null,
		focusedViewProjectPath: overrides.focusedViewProjectPath ?? null,
	} as unknown as PanelStore;
}

const panelsWithState = [
	{ id: "p1", projectPath: "/a" },
	{ id: "p2", projectPath: "/b" },
	{ id: "p3", projectPath: "/a" },
];

const allGroups = [
	{ projectPath: "/a", projectName: "A", projectColor: "#a", projectIconSrc: null },
	{ projectPath: "/b", projectName: "B", projectColor: "#b", projectIconSrc: null },
];

describe("getViewModeState", () => {
	it("multi: layout is cards, no active project, no fullscreen panel", () => {
		const store = createMockPanelStore({ viewMode: "multi" });
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("cards");
		expect(state.isFullscreenMode).toBe(false);
		expect(state.isSingleMode).toBe(false);
		expect(state.activeProjectPath).toBeNull();
		expect(state.focusedModeAllProjects).toBeUndefined();
		expect(state.fullscreenPanel).toBeNull();
	});

	it("single: layout is fullscreen, fullscreen panel is focused panel", () => {
		const store = createMockPanelStore({
			viewMode: "single",
			focusedPanelId: "p2",
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("fullscreen");
		expect(state.isFullscreenMode).toBe(true);
		expect(state.isSingleMode).toBe(true);
		expect(state.fullscreenPanel?.id).toBe("p2");
		expect(state.fullscreenPanel?.projectPath).toBe("/b");
	});

	it("single with no focused panel uses first panel", () => {
		const store = createMockPanelStore({
			viewMode: "single",
			focusedPanelId: null,
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.fullscreenPanel?.id).toBe("p1");
	});

	it("single resolves the fullscreen agent from the focused panel instead of fullscreenPanelId", () => {
		const store = createMockPanelStore({
			viewMode: "single",
			fullscreenPanelId: "p3",
			focusedPanelId: "p2",
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("fullscreen");
		expect(state.fullscreenPanel?.id).toBe("p2");
	});

	it("ignores an explicit agent fullscreen target outside single mode", () => {
		const store = createMockPanelStore({
			viewMode: "project",
			fullscreenPanelId: "p3",
			focusedPanelId: "p2",
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("cards");
		expect(state.isFullscreenMode).toBe(false);
		expect(state.fullscreenPanel).toBeNull();
	});

	it("project: layout cards, activeProjectPath from focusedViewProjectPath", () => {
		const store = createMockPanelStore({
			viewMode: "project",
			focusedViewProjectPath: "/b",
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("cards");
		expect(state.activeProjectPath).toBe("/b");
		expect(state.focusedModeAllProjects).toHaveLength(2);
	});

	it("project: activeProjectPath falls back to focused panel project", () => {
		const store = createMockPanelStore({
			viewMode: "project",
			focusedPanelId: "p2",
			focusedViewProjectPath: null,
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.activeProjectPath).toBe("/b");
	});

	it("supports explicit fullscreen for a non-agent top-level panel", () => {
		const mixedPanels = [
			{ id: "agent-1", projectPath: "/a" },
			{ id: "browser-1", projectPath: "/b" },
		];
		const store = createMockPanelStore({
			viewMode: "multi",
			fullscreenPanelId: "browser-1",
		});

		const state = getViewModeState(store, { panelsWithState: mixedPanels, allGroups });

		expect(state.isFullscreenMode).toBe(false);
		expect(state.fullscreenPanel).toBeNull();
	});

	it("project mode falls back to a focused non-agent panel project", () => {
		const mixedPanels = [
			{ id: "agent-1", projectPath: "/a" },
			{ id: "terminal-1", projectPath: "/b" },
		];
		const store = createMockPanelStore({
			viewMode: "project",
			focusedPanelId: "terminal-1",
			focusedViewProjectPath: null,
		});

		const state = getViewModeState(store, { panelsWithState: mixedPanels, allGroups });

		expect(state.activeProjectPath).toBe("/b");
	});

	it("project with one group: no active project, no focusedModeAllProjects", () => {
		const oneGroup = [allGroups[0]];
		const store = createMockPanelStore({ viewMode: "project" });
		const state = getViewModeState(store, {
			panelsWithState,
			allGroups: oneGroup,
		});
		expect(state.activeProjectPath).toBeNull();
		expect(state.focusedModeAllProjects).toBeUndefined();
	});

	it("kanban: layout is kanban, no fullscreen, no project scoping", () => {
		const store = createMockPanelStore({ viewMode: "kanban" });
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("kanban");
		expect(state.isFullscreenMode).toBe(false);
		expect(state.isSingleMode).toBe(false);
		expect(state.activeProjectPath).toBeNull();
		expect(state.focusedModeAllProjects).toBeUndefined();
		expect(state.fullscreenPanel).toBeNull();
	});
});
