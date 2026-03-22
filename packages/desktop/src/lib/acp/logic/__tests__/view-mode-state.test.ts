/**
 * View mode state tests – getViewModeState() semantics for single/project/multi.
 */

import { describe, expect, it } from "vitest";

import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";

import { getViewModeState } from "../view-mode-state.js";

function createMockPanelStore(overrides: {
	viewMode?: "single" | "project" | "multi";
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
	{ id: "p1", sessionProjectPath: "/a" },
	{ id: "p2", sessionProjectPath: "/b" },
	{ id: "p3", sessionProjectPath: "/a" },
];

const allGroups = [
	{ projectPath: "/a", projectName: "A", projectColor: "#a" },
	{ projectPath: "/b", projectName: "B", projectColor: "#b" },
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
		expect(state.fullscreenPanel?.sessionProjectPath).toBe("/b");
	});

	it("single with no focused panel uses first panel", () => {
		const store = createMockPanelStore({
			viewMode: "single",
			focusedPanelId: null,
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.fullscreenPanel?.id).toBe("p1");
	});

	it("explicit fullscreenPanelId: layout fullscreen, that panel is fullscreen panel", () => {
		const store = createMockPanelStore({
			viewMode: "multi",
			fullscreenPanelId: "p3",
		});
		const state = getViewModeState(store, { panelsWithState, allGroups });
		expect(state.layout).toBe("fullscreen");
		expect(state.fullscreenPanel?.id).toBe("p3");
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
});
