/**
 * PanelStore decomposition safety net (plan 011 U1).
 * check:svelte baseline captured 2026-06-11: 30 errors, 1 warning in 11 files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import type { AgentStore } from "../agent-store.svelte.js";
import { PanelStore } from "../panel-store.svelte.js";
import type { SessionStore } from "../session-store.svelte.js";
import type { Panel, TerminalPanelGroup, TerminalTab, ViewMode } from "../types.js";

type PanelStoreInstance = PanelStore;

type PublicPanelStoreSnapshot = {
	readonly persistablePanelIds: readonly string[];
	readonly focusedPanelId: string | null;
	readonly fullscreenPanelId: string | null;
	readonly viewMode: ViewMode;
	readonly agentPanelIds: readonly string[];
	readonly sessionIdsByPanelId: Record<string, string | null>;
	readonly filePanels: readonly {
		readonly id: string;
		readonly filePath: string;
		readonly ownerPanelId: string | null;
	}[];
	readonly activeAttachedFileByOwner: Record<string, string>;
	readonly activeTopLevelFileByProject: Record<string, string | null>;
	readonly reviewPanelIds: readonly string[];
	readonly browserPanelIds: readonly string[];
	readonly gitPanelIds: readonly string[];
	readonly terminalGroupIds: readonly string[];
	readonly terminalTabIdsByGroup: Record<string, readonly string[]>;
	readonly selectedTerminalTabByGroup: Record<string, string | null>;
	readonly hotStateByPanel: Record<
		string,
		{
			readonly messageDraft: string;
			readonly planSidebarExpanded: boolean;
		}
	>;
};

let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

function createModifiedFilesState(): ModifiedFilesState {
	return {
		files: [],
		byPath: new Map(),
		fileCount: 0,
		totalEditCount: 0,
	};
}

function createStore(sessionId = "session-parity"): PanelStoreInstance {
	const sessionStore = {
		getSessionCold: vi.fn(() => null),
		getSessionIdentity: vi.fn((id: string) =>
			id === sessionId
				? {
						id: sessionId,
						projectPath: "/tmp/project",
						agentId: "claude-code",
					}
				: undefined
		),
		getSessionMetadata: vi.fn((id: string) =>
			id === sessionId
				? {
						title: "Parity session",
						createdAt: new Date("2026-01-01T00:00:00.000Z"),
						updatedAt: new Date("2026-01-01T00:00:00.000Z"),
						parentId: null,
					}
				: undefined
		),
	} as unknown as SessionStore;
	const agentStore = {
		getDefaultAgentId: vi.fn(() => "claude-code"),
	} as unknown as AgentStore;

	return new PanelStore(sessionStore, agentStore, vi.fn());
}

function collectTerminalGroups(store: PanelStoreInstance): TerminalPanelGroup[] {
	const projectPaths = new Set<string>();
	for (const panel of store.workspacePanels) {
		if (panel.kind === "terminal") {
			projectPaths.add(panel.projectPath);
		}
	}

	const groups: TerminalPanelGroup[] = [];
	for (const projectPath of projectPaths) {
		for (const group of store.getTerminalPanelGroupsForProject(projectPath)) {
			groups.push(group);
		}
	}

	return groups.sort((left, right) => left.order - right.order);
}

function collectTerminalTabs(
	store: PanelStoreInstance,
	groups: readonly TerminalPanelGroup[]
): TerminalTab[] {
	const tabs: TerminalTab[] = [];
	for (const group of groups) {
		for (const tab of store.getTerminalTabsForGroup(group.id)) {
			tabs.push(tab);
		}
	}
	return tabs;
}

function capturePublicSnapshot(store: PanelStoreInstance): PublicPanelStoreSnapshot {
	const agentPanels = store.getTopLevelAgentPanels();
	const sessionIdsByPanelId: Record<string, string | null> = {};
	const hotStateByPanel: PublicPanelStoreSnapshot["hotStateByPanel"] = {};
	for (const panel of agentPanels) {
		sessionIdsByPanelId[panel.id] = panel.sessionId;
		const hotState = store.getHotState(panel.id);
		hotStateByPanel[panel.id] = {
			messageDraft: hotState.messageDraft,
			planSidebarExpanded: hotState.planSidebarExpanded,
		};
	}

	const activeAttachedFileByOwner = store.getActiveFilePanelIdByOwnerPanelIdRecord();
	const activeTopLevelFileByProject: Record<string, string | null> = {};
	for (const panel of store.getTopLevelFilePanels()) {
		const activeId = store.getActiveTopLevelFilePanelId(panel.projectPath);
		activeTopLevelFileByProject[panel.projectPath] = activeId;
	}

	const terminalGroups = collectTerminalGroups(store);
	const terminalTabIdsByGroup: Record<string, readonly string[]> = {};
	const selectedTerminalTabByGroup: Record<string, string | null> = {};
	for (const group of terminalGroups) {
		terminalTabIdsByGroup[group.id] = store
			.getTerminalTabsForGroup(group.id)
			.map((tab) => tab.id);
		selectedTerminalTabByGroup[group.id] = store.getSelectedTerminalTabId(group.id);
	}

	return {
		persistablePanelIds: store.getPersistableWorkspacePanels().map((panel) => panel.id),
		focusedPanelId: store.focusedPanelId,
		fullscreenPanelId: store.fullscreenPanelId,
		viewMode: store.viewMode,
		agentPanelIds: store.getTopLevelAgentPanelIds(),
		sessionIdsByPanelId,
		filePanels: store.filePanels.map((panel) => ({
			id: panel.id,
			filePath: panel.filePath,
			ownerPanelId: panel.ownerPanelId,
		})),
		activeAttachedFileByOwner,
		activeTopLevelFileByProject,
		reviewPanelIds: store.reviewPanels.map((panel) => panel.id),
		browserPanelIds: store.browserPanels.map((panel) => panel.id),
		gitPanelIds: store.gitPanels.map((panel) => panel.id),
		terminalGroupIds: terminalGroups.map((group) => group.id),
		terminalTabIdsByGroup,
		selectedTerminalTabByGroup,
		hotStateByPanel,
	};
}

function restorePersistedState(
	target: PanelStoreInstance,
	source: PanelStoreInstance,
	persistablePanels: ReturnType<PanelStoreInstance["getPersistableWorkspacePanels"]>,
	terminalGroups: readonly TerminalPanelGroup[],
	terminalTabs: readonly TerminalTab[],
	activeAttachedFileByOwner: Record<string, string>,
	activeTopLevelFileByProject: Record<string, string | null>,
	hotStateByPanel: PublicPanelStoreSnapshot["hotStateByPanel"]
): void {
	target.restoreWorkspacePanels(persistablePanels);
	target.restoreTerminalPanelState(terminalGroups, terminalTabs);
	target.setActiveFilePanelMap(new Map(Object.entries(activeAttachedFileByOwner)));

	for (const projectPath of Object.keys(activeTopLevelFileByProject)) {
		const filePanelId = activeTopLevelFileByProject[projectPath];
		if (filePanelId !== null && filePanelId !== undefined) {
			target.setActiveTopLevelFilePanel(projectPath, filePanelId);
		}
	}

	for (const panelId of Object.keys(hotStateByPanel)) {
		const hotState = hotStateByPanel[panelId];
		if (hotState === undefined) {
			continue;
		}
		target.setMessageDraft(panelId, hotState.messageDraft);
		target.setPlanSidebarExpanded(panelId, hotState.planSidebarExpanded);
	}

	target.focusedPanelId = source.focusedPanelId;
	target.fullscreenPanelId = source.fullscreenPanelId;
	target.viewMode = source.viewMode;
}

function buildRepresentativeWorkspace(store: PanelStoreInstance): {
	readonly agentPanel: Panel;
	readonly attachedFilePanelId: string;
	readonly topLevelFilePanelId: string;
	readonly reviewPanelId: string;
	readonly terminalGroupId: string;
	readonly browserPanelId: string;
	readonly gitPanelId: string;
} {
	const agentPanel = store.spawnPanel({ projectPath: "/tmp/project" });
	store.updatePanelSession(agentPanel.id, "session-parity");
	store.setMessageDraft(agentPanel.id, "draft before restore");
	store.setPlanSidebarExpanded(agentPanel.id, true);

	const attachedFilePanel = store.openFilePanel("src/attached.ts", "/tmp/project", {
		ownerPanelId: agentPanel.id,
	});
	const topLevelFilePanel = store.openFilePanel("src/top-level.ts", "/tmp/project");
	store.setActiveTopLevelFilePanel("/tmp/project", topLevelFilePanel.id);

	const reviewPanel = store.openReviewPanel("/tmp/project", createModifiedFilesState());
	const terminalGroup = store.openTerminalPanel("/tmp/project");
	store.openTerminalTab(terminalGroup.id);
	const browserPanel = store.openBrowserPanel("/tmp/project", "https://example.com");
	const gitPanel = {
		id: "git-parity",
		kind: "git" as const,
		projectPath: "/tmp/project",
		width: 420,
		ownerPanelId: null,
	};
	store.restoreWorkspacePanels(store.getPersistableWorkspacePanels().concat(gitPanel));

	store.switchFullscreen(terminalGroup.id);
	store.focusPanel(agentPanel.id);

	return {
		agentPanel,
		attachedFilePanelId: attachedFilePanel.id,
		topLevelFilePanelId: topLevelFilePanel.id,
		reviewPanelId: reviewPanel.id,
		terminalGroupId: terminalGroup.id,
		browserPanelId: browserPanel.id,
		gitPanelId: gitPanel.id,
	};
}

beforeEach(() => {
	originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	const localStorageStub: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	};
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: localStorageStub,
	});
});

afterEach(() => {
	if (vi.isFakeTimers()) {
		vi.clearAllTimers();
		vi.useRealTimers();
	}
	if (originalLocalStorageDescriptor === undefined) {
		Reflect.deleteProperty(globalThis, "localStorage");
		return;
	}

	Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
});

describe("PanelStore persistence parity", () => {
	it("round-trips a representative workspace through getPersistable* and restore accessors", () => {
		const source = createStore();
		buildRepresentativeWorkspace(source);

		const before = capturePublicSnapshot(source);
		const persistablePanels = source.getPersistableWorkspacePanels();
		const terminalGroups = collectTerminalGroups(source);
		const terminalTabs = collectTerminalTabs(source, terminalGroups);
		const activeAttachedFileByOwner = source.getActiveFilePanelIdByOwnerPanelIdRecord();
		const activeTopLevelFileByProject = before.activeTopLevelFileByProject;
		const hotStateByPanel = before.hotStateByPanel;

		const restored = createStore();
		restorePersistedState(
			restored,
			source,
			persistablePanels,
			terminalGroups,
			terminalTabs,
			activeAttachedFileByOwner,
			activeTopLevelFileByProject,
			hotStateByPanel
		);

		const after = capturePublicSnapshot(restored);
		expect(after).toEqual(before);
	});

	it("keeps session and panel indexes consistent through open, focus, and close", () => {
		const store = createStore("session-lifecycle");
		const first = store.openSession("session-lifecycle", 450);
		const second = store.spawnPanel({ projectPath: "/tmp/other" });

		expect(first).not.toBeNull();
		expect(store.getPanelBySessionId("session-lifecycle")).toBe(first);
		expect(store.isSessionOpen("session-lifecycle")).toBe(true);
		expect(store.getTopLevelAgentPanelIds()).toEqual([second ? second.id : "", first ? first.id : ""]);

		store.focusPanel(first ? first.id : "");
		expect(store.focusedPanel).toBe(first);
		expect(store.focusedPanelId).toBe(first ? first.id : null);

		store.closePanel(first ? first.id : "");

		expect(store.getPanelBySessionId("session-lifecycle")).toBeUndefined();
		expect(store.isSessionOpen("session-lifecycle")).toBe(false);
		expect(store.getTopLevelAgentPanelIds()).toEqual([second ? second.id : ""]);
		expect(store.focusedPanelId).toBe(second ? second.id : null);
	});
});
