import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	},
	configurable: true,
});

function createStore(persist: () => void): PanelStore {
	const sessionStore = {
		getSessionCold: vi.fn(() => null),
		getSessionIdentity: vi.fn(() => undefined),
		getSessionMetadata: vi.fn(() => undefined),
	} as unknown as SessionStore;
	const agentStore = {
		getDefaultAgentId: vi.fn(() => "claude-code"),
	} as unknown as AgentStore;

	return new PanelStore(sessionStore, agentStore, persist);
}

afterEach(() => {
	if (vi.isFakeTimers()) {
		vi.runOnlyPendingTimers();
		vi.clearAllTimers();
		vi.useRealTimers();
	}
});

describe("PanelStore file panel activation", () => {
	it("switches the active attached file immediately before persistence runs", () => {
		vi.useFakeTimers();
		const persist = vi.fn();
		const store = createStore(persist);
		const owner = store.spawnPanel({ projectPath: "/tmp/project" });
		const firstPanel = store.openFilePanel("src/one.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});
		store.openFilePanel("src/two.ts", "/tmp/project", {
			ownerPanelId: owner.id,
		});

		vi.runOnlyPendingTimers();
		persist.mockClear();

		store.setActiveAttachedFilePanel(owner.id, firstPanel.id);

		expect(store.getActiveFilePanelId(owner.id)).toBe(firstPanel.id);
		expect(store.getActiveAttachedFilePanel(owner.id)).toBe(firstPanel);
		expect(persist).not.toHaveBeenCalled();

		vi.runOnlyPendingTimers();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("switches the active top-level file immediately before persistence runs", () => {
		vi.useFakeTimers();
		const persist = vi.fn();
		const store = createStore(persist);
		const firstPanel = store.openFilePanel("src/one.ts", "/tmp/project");
		const secondPanel = store.openFilePanel("src/two.ts", "/tmp/project");

		vi.runOnlyPendingTimers();
		persist.mockClear();

		store.setActiveTopLevelFilePanel("/tmp/project", firstPanel.id);

		expect(store.getActiveTopLevelFilePanelId("/tmp/project")).toBe(firstPanel.id);
		expect(store.getFilePanel(secondPanel.id)).toBe(secondPanel);
		expect(persist).not.toHaveBeenCalled();

		vi.runOnlyPendingTimers();
		expect(persist).toHaveBeenCalledTimes(1);
	});
});
