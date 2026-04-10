import { describe, expect, it, vi } from "vitest";

import { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import { SessionStore } from "../session-store.svelte.js";
import type { TerminalTab } from "../types.js";

type PanelStoreInstance = InstanceType<typeof PanelStore>;

function requireValue<T>(value: T | null): T {
	expect(value).not.toBeNull();
	if (value === null) {
		throw new Error("Expected value");
	}
	return value;
}

function createStore(): PanelStoreInstance {
	const sessionStore = Object.create(SessionStore.prototype) as SessionStore;
	const agentStore = Object.create(AgentStore.prototype) as AgentStore;

	sessionStore.getSessionCold = vi.fn(() => undefined);
	agentStore.getDefaultAgentId = vi.fn(() => "claude-code");

	const terminalStore = new PanelStore(sessionStore, agentStore, vi.fn());

	return terminalStore;
}

describe("PanelStore terminal groups", () => {
	it("creates a top-level terminal group with one selected tab", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");

		const tabs = store.getTerminalTabsForGroup(group.id);

		expect(tabs).toHaveLength(1);
		expect(store.getSelectedTerminalTabId(group.id)).toBe(tabs[0]?.id);
	});

	it("adds a new tab to the current group with openTerminalTab", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");

		const secondTab = requireValue(store.openTerminalTab(group.id));
		const tabs = store.getTerminalTabsForGroup(group.id);

		expect(tabs).toHaveLength(2);
		expect(tabs[1]?.id).toBe(secondTab.id);
		expect(store.getSelectedTerminalTabId(group.id)).toBe(secondTab.id);
	});

	it("no-ops and logs when opening a tab for a stale group", () => {
		const store = createStore();
		const loggerSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = store.openTerminalTab("missing-group");

		expect(result).toBeNull();
		expect(store.terminalTabs).toHaveLength(0);
		expect(store.terminalPanelGroups).toHaveLength(0);
		expect(store.workspacePanels).toHaveLength(0);
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});

	it("moves the selected tab into a new panel immediately to the right", () => {
		const store = createStore();
		const sourceGroup = store.openTerminalPanel("/tmp/project");
		const movedTab = requireValue(store.openTerminalTab(sourceGroup.id));

		const newGroup = store.moveTerminalTabToNewPanel(movedTab.id);

		expect(newGroup).not.toBeNull();
		if (!newGroup) {
			throw new Error("expected moved tab to create a new terminal group");
		}
		expect(store.getTerminalTabsForGroup(sourceGroup.id)).toHaveLength(1);
		expect(store.getTerminalTabsForGroup(newGroup.id).map((tab) => tab.id)).toEqual([movedTab.id]);
		expect(store.getTerminalPanelGroupsForProject("/tmp/project").map((group) => group.id)).toEqual(
			[sourceGroup.id, newGroup.id]
		);
	});

	it("preserves the live terminal runtime state when popping out a tab", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const tab = requireValue(store.openTerminalTab(group.id));

		store.updateTerminalPtyId(tab.id, 42, "/bin/zsh");

		const newGroup = store.moveTerminalTabToNewPanel(tab.id);
		const movedTab = newGroup ? store.getTerminalTabsForGroup(newGroup.id)[0] : null;

		expect(movedTab?.id).toBe(tab.id);
		expect(movedTab?.ptyId).toBe(42);
		expect(movedTab?.shell).toBe("/bin/zsh");
	});

	it("selects the next tab to the right after moving the selected tab, then falls back left", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const second = requireValue(store.openTerminalTab(group.id));
		const third = requireValue(store.openTerminalTab(group.id));

		store.setSelectedTerminalTab(group.id, second.id);
		store.moveTerminalTabToNewPanel(second.id);

		expect(store.getSelectedTerminalTabId(group.id)).toBe(third.id);

		store.closeTerminalTab(third.id);

		expect(store.getSelectedTerminalTabId(group.id)).toBe(
			store.getTerminalTabsForGroup(group.id)[0]?.id
		);
	});

	it("no-ops and logs when moving a stale tab id", () => {
		const store = createStore();
		const loggerSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = store.moveTerminalTabToNewPanel("missing-tab");

		expect(result).toBeNull();
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});

	it("disables pop-out for a single-tab group", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const onlyTab = store.getTerminalTabsForGroup(group.id)[0];

		const result = onlyTab ? store.canMoveTerminalTabToNewPanel(onlyTab.id) : true;

		expect(result).toBe(false);
	});

	it("returns null and leaves state unchanged when moving the only tab in a group", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const onlyTab = store.getTerminalTabsForGroup(group.id)[0];
		const loggerSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(onlyTab).toBeDefined();

		const result = onlyTab ? store.moveTerminalTabToNewPanel(onlyTab.id) : "unexpected";

		expect(result).toBeNull();
		expect(
			store.getTerminalPanelGroupsForProject("/tmp/project").map((candidate) => candidate.id)
		).toEqual([group.id]);
		expect(store.getTerminalTabsForGroup(group.id).map((candidate) => candidate.id)).toEqual([
			onlyTab?.id,
		]);
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});

	it("keeps the source group when the remaining only tab cannot be moved", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		store.openTerminalTab(group.id);
		const third = requireValue(store.openTerminalTab(group.id));

		const tabsBeforeMove = store.getTerminalTabsForGroup(group.id);
		const firstTabId = tabsBeforeMove[0]?.id;
		const secondTabId = tabsBeforeMove[1]?.id;

		expect(firstTabId).toBeDefined();
		expect(secondTabId).toBeDefined();

		if (firstTabId) {
			store.closeTerminalTab(firstTabId);
		}
		if (secondTabId) {
			store.closeTerminalTab(secondTabId);
		}

		const loggerSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const newGroup = store.moveTerminalTabToNewPanel(third.id);

		expect(newGroup).toBeNull();
		expect(store.getTerminalPanelGroup(group.id)).toBeDefined();
		expect(store.getTerminalTabsForGroup(group.id).map((tab) => tab.id)).toEqual([third.id]);
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});

	it("keeps workspace panels in sync with terminal group lifecycle", () => {
		const store = createStore();
		const agentPanel = store.spawnPanel({ id: "agent-panel" });
		const group = store.openTerminalPanel("/tmp/project", 640);
		const terminalWorkspacePanel = store.workspacePanels.find(
			(panel): panel is Extract<(typeof store.workspacePanels)[number], { kind: "terminal" }> =>
				panel.kind === "terminal" && panel.id === group.id
		);

		expect(terminalWorkspacePanel).toBeDefined();
		expect(terminalWorkspacePanel?.groupId).toBe(group.id);
		expect(terminalWorkspacePanel?.width).toBe(640);
		expect(store.workspacePanels.map((panel) => panel.id)).toEqual([agentPanel.id, group.id]);

		store.resizeTerminalPanel(group.id, -40);

		const resizedPanel = store.workspacePanels.find(
			(panel): panel is Extract<(typeof store.workspacePanels)[number], { kind: "terminal" }> =>
				panel.kind === "terminal" && panel.id === group.id
		);
		expect(resizedPanel?.width).toBe(600);

		const nextTab = requireValue(store.openTerminalTab(group.id));
		const poppedGroup = store.moveTerminalTabToNewPanel(nextTab.id);
		const terminalPanels = store.workspacePanels.filter(
			(panel): panel is Extract<(typeof store.workspacePanels)[number], { kind: "terminal" }> =>
				panel.kind === "terminal"
		);

		expect(store.workspacePanels.map((panel) => panel.id)).toEqual([
			agentPanel.id,
			group.id,
			poppedGroup?.id,
		]);
		expect(terminalPanels.map((panel) => panel.id)).toEqual([group.id, poppedGroup?.id]);
		expect(terminalPanels.map((panel) => panel.groupId)).toEqual([group.id, poppedGroup?.id]);

		const remainingTab = store.getTerminalTabsForGroup(group.id)[0] as TerminalTab;
		const loggerSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const secondMoveResult = store.moveTerminalTabToNewPanel(remainingTab.id);

		expect(secondMoveResult).toBeNull();
		expect(store.workspacePanels.some((panel) => panel.id === group.id)).toBe(true);
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});

	it("no-ops and logs when updating PTY state for a stale tab id", () => {
		const store = createStore();
		const group = store.openTerminalPanel("/tmp/project");
		const originalTab = store.getTerminalTabsForGroup(group.id)[0];
		const loggerSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(originalTab).toBeDefined();

		store.updateTerminalPtyId("missing-tab", 42, "/bin/zsh");

		const unchangedTab = store.getTerminalTabsForGroup(group.id)[0];
		expect(unchangedTab?.id).toBe(originalTab?.id);
		expect(unchangedTab?.ptyId).toBeNull();
		expect(unchangedTab?.shell).toBeNull();
		expect(loggerSpy).toHaveBeenCalled();
		loggerSpy.mockRestore();
	});
});
