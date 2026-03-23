import { describe, expect, it, vi } from "vitest";

import type { AgentStore } from "../agent-store.svelte.js";
import { EmbeddedTerminalStore } from "../embedded-terminal-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";

function createStore(): { store: EmbeddedTerminalStore; onPersist: ReturnType<typeof vi.fn> } {
	const onPersist = vi.fn();
	const store = new EmbeddedTerminalStore(onPersist);
	return { store, onPersist };
}

function createPanelStore(): { panelStore: PanelStore; persist: ReturnType<typeof vi.fn> } {
	const sessionStore = {} as SessionStore;
	const agentStore = {} as AgentStore;
	const persist = vi.fn();
	return { panelStore: new PanelStore(sessionStore, agentStore, persist), persist };
}

describe("EmbeddedTerminalStore", () => {
	describe("tab management", () => {
		it("adds a tab and selects it", () => {
			const { store } = createStore();
			const tab = store.addTab("panel-1", "/projects/app");

			expect(tab.id).toBeDefined();
			expect(tab.cwd).toBe("/projects/app");
			expect(tab.ptyId).toBeNull();
			expect(tab.shell).toBeNull();

			expect(store.getTabs("panel-1")).toHaveLength(1);
			expect(store.getSelectedTabId("panel-1")).toBe(tab.id);
		});

		it("adds multiple tabs and selects the latest", () => {
			const { store } = createStore();
			const tab1 = store.addTab("panel-1", "/projects/app");
			const tab2 = store.addTab("panel-1", "/projects/app");

			expect(store.getTabs("panel-1")).toHaveLength(2);
			expect(store.getSelectedTabId("panel-1")).toBe(tab2.id);
		});

		it("closes a tab and updates selection", () => {
			const { store } = createStore();
			const tab1 = store.addTab("panel-1", "/projects/app");
			const tab2 = store.addTab("panel-1", "/projects/app");

			// Selected is tab2, close it
			store.closeTab("panel-1", tab2.id);

			expect(store.getTabs("panel-1")).toHaveLength(1);
			expect(store.getSelectedTabId("panel-1")).toBe(tab1.id);
		});

		it("closes last tab and returns null selection", () => {
			const { store } = createStore();
			const tab = store.addTab("panel-1", "/projects/app");
			store.closeTab("panel-1", tab.id);

			expect(store.getTabs("panel-1")).toHaveLength(0);
			expect(store.getSelectedTabId("panel-1")).toBeNull();
		});

		it("selects a specific tab", () => {
			const { store } = createStore();
			const tab1 = store.addTab("panel-1", "/projects/app");
			const tab2 = store.addTab("panel-1", "/projects/app");

			store.setSelectedTab("panel-1", tab1.id);
			expect(store.getSelectedTabId("panel-1")).toBe(tab1.id);
		});

		it("falls back to first tab if selected tab is stale", () => {
			const { store } = createStore();
			const tab1 = store.addTab("panel-1", "/projects/app");
			store.setSelectedTab("panel-1", "nonexistent-id");

			expect(store.getSelectedTabId("panel-1")).toBe(tab1.id);
		});

		it("returns empty array for unknown panel", () => {
			const { store } = createStore();
			expect(store.getTabs("unknown")).toHaveLength(0);
			expect(store.getSelectedTabId("unknown")).toBeNull();
		});
	});

	describe("PTY updates", () => {
		it("updates a tab's PTY state", () => {
			const { store, onPersist } = createStore();
			const tab = store.addTab("panel-1", "/projects/app");
			onPersist.mockClear();

			store.updatePty("panel-1", tab.id, 12345, "/bin/zsh");

			const updated = store.getTabs("panel-1")[0]!;
			expect(updated.ptyId).toBe(12345);
			expect(updated.shell).toBe("/bin/zsh");

			// PTY updates are runtime-only — no persist
			expect(onPersist).not.toHaveBeenCalled();
		});
	});

	describe("cleanup", () => {
		it("removes all state for a panel", () => {
			const { store } = createStore();
			store.addTab("panel-1", "/projects/app");
			store.addTab("panel-1", "/projects/app");

			store.cleanup("panel-1");

			expect(store.getTabs("panel-1")).toHaveLength(0);
			expect(store.getSelectedTabId("panel-1")).toBeNull();
		});
	});

	describe("persistence", () => {
		it("serializes tabs without runtime fields", () => {
			const { store } = createStore();
			const tab = store.addTab("panel-1", "/projects/app");
			store.updatePty("panel-1", tab.id, 12345, "/bin/zsh");

			const serialized = store.serialize();
			expect(serialized).toEqual([
				{
					panelId: "panel-1",
					tabs: [{ id: tab.id, cwd: "/projects/app" }],
				},
			]);
		});

		it("skips panels with no tabs", () => {
			const { store } = createStore();
			store.addTab("panel-1", "/projects/app");
			store.closeTab("panel-1", store.getTabs("panel-1")[0]?.id);

			const serialized = store.serialize();
			expect(serialized).toHaveLength(0);
		});

		it("restores tabs with panel ID remap", () => {
			const { store } = createStore();
			const tab = store.addTab("old-panel-id", "/projects/app");
			const serialized = store.serialize();

			// Create a fresh store and restore with remap
			const { store: restored } = createStore();
			const panelIdMap = new Map([["old-panel-id", "new-panel-id"]]);
			restored.restore(serialized, panelIdMap, new Map([["old-panel-id", tab.id]]));

			expect(restored.getTabs("new-panel-id")).toHaveLength(1);
			expect(restored.getTabs("new-panel-id")[0]?.cwd).toBe("/projects/app");
			expect(restored.getTabs("new-panel-id")[0]?.ptyId).toBeNull();
			expect(restored.getSelectedTabId("new-panel-id")).toBe(tab.id);

			// Old panel ID should have nothing
			expect(restored.getTabs("old-panel-id")).toHaveLength(0);
		});
	});

	describe("calls onPersist", () => {
		it("on addTab", () => {
			const { store, onPersist } = createStore();
			store.addTab("panel-1", "/projects/app");
			expect(onPersist).toHaveBeenCalledTimes(1);
		});

		it("on closeTab", () => {
			const { store, onPersist } = createStore();
			const tab = store.addTab("panel-1", "/projects/app");
			onPersist.mockClear();
			store.closeTab("panel-1", tab.id);
			expect(onPersist).toHaveBeenCalledTimes(1);
		});

		it("on setSelectedTab", () => {
			const { store, onPersist } = createStore();
			const tab = store.addTab("panel-1", "/projects/app");
			onPersist.mockClear();
			store.setSelectedTab("panel-1", tab.id);
			expect(onPersist).toHaveBeenCalledTimes(1);
		});
	});
});

describe("PanelStore.closePanel cleans up embedded terminals", () => {
	it("cleans up embedded terminal state when panel is closed", () => {
		const { panelStore } = createPanelStore();

		// Create a panel
		panelStore.panels = [
			{
				id: "test-panel",
				sessionId: null,
				width: 500,
				pendingProjectSelection: false,
				selectedAgentId: null,
				projectPath: "/projects/app",
				agentId: null,
				sessionTitle: null,
			},
		];

		// Add embedded terminal tabs
		panelStore.embeddedTerminals.addTab("test-panel", "/projects/app");
		panelStore.embeddedTerminals.addTab("test-panel", "/projects/app");
		expect(panelStore.embeddedTerminals.getTabs("test-panel")).toHaveLength(2);

		// Close the panel
		panelStore.closePanel("test-panel");

		// Embedded terminal state should be cleaned up
		expect(panelStore.embeddedTerminals.getTabs("test-panel")).toHaveLength(0);
		expect(panelStore.embeddedTerminals.getSelectedTabId("test-panel")).toBeNull();
	});
});
