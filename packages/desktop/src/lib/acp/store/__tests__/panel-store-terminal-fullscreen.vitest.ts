import { describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

function requireValue<T>(value: T | null): T {
	expect(value).not.toBeNull();
	if (value === null) {
		throw new Error("Expected value");
	}
	return value;
}

function createStore(): PanelStore {
	const sessionStore = {} as SessionStore;
	const agentStore = {} as AgentStore;
	const persist = vi.fn();

	return new PanelStore(sessionStore, agentStore, persist);
}

describe("PanelStore terminal fullscreen", () => {
	it("normalizes agent fullscreen targets to single view mode", () => {
		const store = createStore();
		const panel = store.spawnPanel({ projectPath: "/tmp/project" });

		store.viewMode = "project";
		store.switchFullscreen(panel.id);

		expect(store.viewMode).toBe("single");
		expect(store.fullscreenPanelId).toBe(panel.id);
	});

	it("keeps terminal fullscreen separate from single view mode", () => {
		const store = createStore();
		store.viewMode = "project";
		const group = store.openTerminalPanel("/tmp/project");

		store.enterTerminalFullscreen(group.id);

		expect(store.viewMode).toBe("project");
		expect(store.fullscreenPanelId).toBe(group.id);
	});

	it("enters fullscreen for a terminal without creating an agent panel", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");

		expect(store.panels).toHaveLength(0);
		expect(store.fullscreenPanelId).toBe(group.id);

		store.enterTerminalFullscreen(group.id);

		expect(store.panels).toHaveLength(0);
		expect(store.fullscreenPanelId).toBe(group.id);
	});

	it("keeps the new terminal group focused after pop-out", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const tab = requireValue(store.openTerminalTab(group.id));

		const newGroup = store.moveTerminalTabToNewPanel(tab.id);

		expect(newGroup).not.toBeNull();
		expect(store.focusedPanelId).toBe(newGroup?.id);
	});

	it("moves fullscreen to the new terminal group after pop-out when fullscreen is already active", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const tab = requireValue(store.openTerminalTab(group.id));

		store.enterTerminalFullscreen(group.id);
		const newGroup = store.moveTerminalTabToNewPanel(tab.id);

		expect(newGroup).not.toBeNull();
		expect(store.fullscreenPanelId).toBe(newGroup?.id);
	});

	it("does not move fullscreen after pop-out when fullscreen is inactive", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const tab = requireValue(store.openTerminalTab(group.id));

		store.exitFullscreen();
		const newGroup = store.moveTerminalTabToNewPanel(tab.id);

		expect(newGroup).not.toBeNull();
		expect(store.fullscreenPanelId).toBeNull();
	});
});
