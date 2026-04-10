import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";

import type { Panel, WorkspacePanel } from "../types.js";

type TerminalPanelGroupStub = {
	id: string;
	projectPath: string;
	width: number;
	selectedTabId: string | null;
	order: number;
};

type TerminalTabStub = {
	id: string;
	groupId: string;
	projectPath: string;
	createdAt: number;
	ptyId: number | null;
	shell: string | null;
};

const saveWorkspaceStateMock = mock(
	(_state: Record<string, boolean | number | object | string | null | undefined>) =>
		okAsync(undefined)
);
const loadWorkspaceStateMock = mock(() => okAsync(null));

mock.module("../api.js", () => ({
	api: {
		saveWorkspaceState: saveWorkspaceStateMock,
		loadWorkspaceState: loadWorkspaceStateMock,
	},
}));

import { WorkspaceStore } from "../workspace-store.svelte.js";

function createPanelStoreStub() {
	const store = {
		workspacePanels: [] as WorkspacePanel[],
		panels: [] as Panel[],
		filePanels: [],
		terminalPanelGroups: [] as TerminalPanelGroupStub[],
		terminalTabs: [] as TerminalTabStub[],
		terminalPanels: [],
		browserPanels: [],
		reviewPanels: [],
		gitPanels: [],
		scrollX: 0,
		focusedPanelId: null as string | null,
		fullscreenPanelId: null as string | null,
		viewMode: "multi" as "single" | "project" | "multi",
		focusedViewProjectPath: null,
		embeddedTerminals: {
			serialize: mock(() => []),
			restore: mock(() => {}),
			getSelectedTabId: mock(() => null),
		},
		switchFullscreen: mock((panelId: string) => {
			store.fullscreenPanelId = panelId;
		}),
		ensureSingleViewForAgentFullscreen: mock(() => {
			if (
				store.fullscreenPanelId &&
				store.workspacePanels.some(
					(panel: WorkspacePanel) => panel.id === store.fullscreenPanelId && panel.kind === "agent"
				)
			) {
				store.viewMode = "single";
			}
		}),
		getTerminalPanelGroup: mock(() => undefined),
		getTerminalTabsForGroup: mock(() => []),
		getActiveFilePanelIdByOwnerPanelIdRecord: mock(() => ({})),
		setActiveFilePanelMap: mock(() => {}),
		hotState: new SvelteMap(),
		setPlanSidebarExpanded: mock(() => {}),
		setMessageDraft: mock(() => {}),
		setPendingReviewRestore: mock(() => {}),
		setEmbeddedTerminalDrawerOpen: mock(() => {}),
		getHotState: mock(() => ({
			planSidebarExpanded: true,
			messageDraft: "",
			reviewMode: false,
			reviewFileIndex: 0,
			embeddedTerminalDrawerOpen: false,
		})),
	};

	return store;
}

function createSessionStoreStub() {
	return {
		getSessionIdentity: mock(() => undefined),
		getSessionMetadata: mock(() => undefined),
	} as const;
}

describe("workspace sidebar state persistence", () => {
	beforeEach(() => {
		saveWorkspaceStateMock.mockClear();
		loadWorkspaceStateMock.mockClear();
	});

	it("restores collapsed project paths even when the saved list is empty", () => {
		const store = new WorkspaceStore(
			createPanelStoreStub() as never,
			createSessionStoreStub() as never
		);
		const restoredValues: string[][] = [];

		store.registerProviders({
			setCollapsedProjectPaths: (paths) => {
				restoredValues.push(paths);
			},
		});

		store.restore({
			version: 9,
			panels: [],
			focusedPanelIndex: null,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
			collapsedProjectPaths: [],
		});

		expect(restoredValues).toEqual([[]]);
	});

	it("restores collapsed project paths for unified workspace panels", () => {
		const store = new WorkspaceStore(
			createPanelStoreStub() as never,
			createSessionStoreStub() as never
		);
		const restoredValues: string[][] = [];

		store.registerProviders({
			setCollapsedProjectPaths: (paths) => {
				restoredValues.push(paths);
			},
		});

		store.restore({
			version: 10,
			workspacePanels: [
				{
					id: "agent-1",
					kind: "agent",
					projectPath: "/workspace/app",
					ownerPanelId: null,
					width: 640,
					sessionId: "session-1",
					pendingProjectSelection: false,
					selectedAgentId: null,
					agentId: null,
				},
			],
			panels: [],
			focusedPanelIndex: 0,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
			collapsedProjectPaths: ["/workspace/app"],
		});

		expect(restoredValues).toEqual([["/workspace/app"]]);
	});

	it("can persist sidebar collapse state immediately", () => {
		const store = new WorkspaceStore(
			createPanelStoreStub() as never,
			createSessionStoreStub() as never
		);

		store.registerProviders({
			getCollapsedProjectPaths: () => ["/workspace/app"],
		});

		store.persist(true);

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		const calls = saveWorkspaceStateMock.mock.calls as unknown as Array<ReadonlyArray<unknown>>;
		const firstCall = calls[0];
		expect(firstCall).toBeDefined();
		const savedState = firstCall?.[0] as Record<string, unknown> | undefined;
		expect(savedState).toMatchObject({
			collapsedProjectPaths: ["/workspace/app"],
		});
	});

	it("persists terminal panel groups and tabs", () => {
		const panelStore = createPanelStoreStub();
		panelStore.terminalPanelGroups = [
			{
				id: "group-1",
				projectPath: "/workspace/app",
				width: 500,
				selectedTabId: "tab-2",
				order: 0,
			},
		];
		panelStore.terminalTabs = [
			{
				id: "tab-1",
				groupId: "group-1",
				projectPath: "/workspace/app",
				createdAt: 1,
				ptyId: null,
				shell: null,
			},
			{
				id: "tab-2",
				groupId: "group-1",
				projectPath: "/workspace/app",
				createdAt: 2,
				ptyId: null,
				shell: null,
			},
		];

		const store = new WorkspaceStore(panelStore as never, createSessionStoreStub() as never);

		store.persist(true);

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		const calls = saveWorkspaceStateMock.mock.calls;
		expect(calls.length).toBe(1);
		const firstCall = calls.at(0);
		if (!firstCall) {
			throw new Error("expected saved workspace state");
		}
		const savedState = firstCall[0];
		expect(savedState.terminalPanelGroups).toEqual([
			{
				id: "group-1",
				projectPath: "/workspace/app",
				width: 500,
				selectedTabId: "tab-2",
				order: 0,
			},
		]);
		expect(savedState.terminalTabs).toEqual([
			{ id: "tab-1", groupId: "group-1", projectPath: "/workspace/app", createdAt: 1 },
			{ id: "tab-2", groupId: "group-1", projectPath: "/workspace/app", createdAt: 2 },
		]);
	});

	it("persists and restores worktree session context", () => {
		const panelStore = createPanelStoreStub();
		panelStore.panels = [
			{
				id: "panel-1",
				sessionId: "session-1",
				width: 640,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				projectPath: "/workspace/app",
				agentId: "claude-code",
				sessionTitle: "Feature thread",
				kind: "agent",
				ownerPanelId: null,
				sourcePath: null,
				worktreePath: null,
			},
		] as Panel[];

		const sessionStore = {
			getSessionIdentity: mock(() => ({
				id: "session-1",
				projectPath: "/workspace/app",
				agentId: "claude-code",
				worktreePath: "/workspace/app/.git/worktrees/feature-a",
			})),
			getSessionMetadata: mock(() => ({
				title: "Feature thread",
				createdAt: new Date("2026-03-27T00:00:00.000Z"),
				updatedAt: new Date("2026-03-27T00:00:00.000Z"),
				sourcePath: "/workspace/app/.cursor/sessions/session-1.json",
				parentId: null,
			})),
		} as const;

		const store = new WorkspaceStore(panelStore as never, sessionStore as never);

		store.persist(true);

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		const calls = saveWorkspaceStateMock.mock.calls as Array<ReadonlyArray<unknown>>;
		const savedState = calls[0]?.[0] as { panels?: Array<Record<string, unknown>> } | undefined;
		const savedPanel = savedState?.panels?.[0];
		expect(savedPanel).toMatchObject({
			sourcePath: "/workspace/app/.cursor/sessions/session-1.json",
			worktreePath: "/workspace/app/.git/worktrees/feature-a",
		});

		const restoredPanels = store.restore({
			version: 11,
			panels: [
				{
					id: "persisted-panel-1",
					sessionId: "session-1",
					width: 640,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/workspace/app",
					agentId: "claude-code",
					sessionTitle: "Feature thread",
					sourcePath: "/workspace/app/.cursor/sessions/session-1.json",
					worktreePath: "/workspace/app/.git/worktrees/feature-a",
				},
			],
			focusedPanelIndex: 0,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
		});

		expect(restoredPanels).toEqual(["session-1"]);
		expect(panelStore.panels).toHaveLength(1);
		expect(panelStore.panels[0]).toMatchObject({
			sourcePath: "/workspace/app/.cursor/sessions/session-1.json",
			worktreePath: "/workspace/app/.git/worktrees/feature-a",
		});
	});
});
