import { describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

vi.stubGlobal("localStorage", {
	getItem: vi.fn(() => null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
});

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
	it("uses single view mode for agent fullscreen without storing an aux fullscreen target", () => {
		const store = createStore();
		const panel = store.spawnPanel({ projectPath: "/tmp/project" });

		store.viewMode = "project";
		store.switchFullscreen(panel.id);

		expect(store.viewMode).toBe("single");
		expect(store.fullscreenPanelId).toBeNull();
	});

	it("uses single view mode for terminal fullscreen without storing a separate fullscreen target", () => {
		const store = createStore();
		store.viewMode = "project";
		const group = store.openTerminalPanel("/tmp/project");

		store.enterTerminalFullscreen(group.id);

		expect(store.viewMode).toBe("single");
		expect(store.focusedPanelId).toBe(group.id);
		expect(store.fullscreenPanelId).toBeNull();
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

	it("keeps single mode on the next remaining agent when closing the visible single-mode agent", () => {
		const store = createStore();
		const first = store.spawnPanel({ projectPath: "/tmp/project-a" });
		const second = store.spawnPanel({ projectPath: "/tmp/project-b" });

		store.viewMode = "project";
		store.switchFullscreen(first.id);
		store.closePanel(first.id);

		expect(store.viewMode).toBe("single");
		expect(store.focusedPanelId).toBe(second.id);
		expect(store.fullscreenPanelId).toBeNull();
	});

	it("exits single mode when closing the last visible single-mode agent", () => {
		const store = createStore();
		const panel = store.spawnPanel({ projectPath: "/tmp/project" });

		store.viewMode = "project";
		store.switchFullscreen(panel.id);
		store.closePanel(panel.id);

		expect(store.viewMode).toBe("multi");
		expect(store.fullscreenPanelId).toBeNull();
	});

	it("keeps single mode on the next remaining top-level panel when closing the visible terminal", () => {
		const store = createStore();
		const first = store.openTerminalPanel("/tmp/project-a");
		const second = store.openTerminalPanel("/tmp/project-b");

		store.viewMode = "project";
		store.switchFullscreen(first.id);
		store.closeTerminalPanel(first.id);

		expect(store.viewMode).toBe("single");
		expect(store.focusedPanelId).toBe(second.id);
		expect(store.fullscreenPanelId).toBeNull();
	});
});
