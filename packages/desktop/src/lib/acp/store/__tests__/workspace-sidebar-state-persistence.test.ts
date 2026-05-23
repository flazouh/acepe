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
		getPersistableWorkspacePanels: mock(() => {
			const persistableTopLevelPanelIds = new Set<string>();
			for (const panel of store.workspacePanels) {
				if (
					panel.ownerPanelId === null &&
					(panel.kind !== "agent" || panel.autoCreated !== true)
				) {
					persistableTopLevelPanelIds.add(panel.id);
				}
			}
			return store.workspacePanels.filter((panel) => {
				if (panel.kind === "agent" && panel.autoCreated === true) {
					return false;
				}
				return panel.ownerPanelId === null || persistableTopLevelPanelIds.has(panel.ownerPanelId);
			});
		}),
		setActiveFilePanelMap: mock(() => {}),
		restoreWorkspacePanels: mock((workspacePanels: WorkspacePanel[]) => {
			store.workspacePanels = workspacePanels;
			store.panels = workspacePanels.filter((panel): panel is Panel => panel.kind === "agent");
			store.filePanels = workspacePanels.filter((panel) => panel.kind === "file") as never[];
			store.terminalPanels = workspacePanels.filter((panel) => panel.kind === "terminal") as never[];
			store.browserPanels = workspacePanels.filter((panel) => panel.kind === "browser") as never[];
			store.reviewPanels = workspacePanels.filter((panel) => panel.kind === "review") as never[];
			store.gitPanels = workspacePanels.filter((panel) => panel.kind === "git") as never[];
		}),
		restoreTerminalPanelState: mock(
			(groups: TerminalPanelGroupStub[], tabs: TerminalTabStub[]) => {
				store.terminalPanelGroups = groups;
				store.terminalTabs = tabs;
				store.terminalPanels = groups.map((group) => ({
					id: group.id,
					kind: "terminal" as const,
					projectPath: group.projectPath,
					width: group.width,
					ownerPanelId: null,
					groupId: group.id,
				})) as never[];
				store.workspacePanels = store.workspacePanels
					.filter((panel) => panel.kind !== "terminal")
					.concat(store.terminalPanels);
			}
		),
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

	it("drops auto-created unified workspace panels on restore", () => {
		const panelStore = createPanelStoreStub();
		const store = new WorkspaceStore(panelStore as never, createSessionStoreStub() as never);

		const restoredSessionIds = store.restore({
			version: 12,
			workspacePanels: [
				{
					id: "auto-panel",
					kind: "agent",
					projectPath: "/workspace/app",
					ownerPanelId: null,
					width: 640,
					sessionId: "auto-session",
					autoCreated: true,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					agentId: "claude-code",
				},
				{
					id: "durable-panel",
					kind: "agent",
					projectPath: "/workspace/app",
					ownerPanelId: null,
					width: 640,
					sessionId: "durable-session",
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					agentId: "claude-code",
				},
			],
			panels: [],
			focusedPanelIndex: 0,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
		});

		expect(restoredSessionIds).toEqual(["durable-session"]);
		expect(panelStore.workspacePanels).toHaveLength(1);
		expect(panelStore.workspacePanels[0]).toMatchObject({ id: "durable-panel" });
	});

	it("drops auto-created legacy panels on restore", () => {
		const panelStore = createPanelStoreStub();
		const store = new WorkspaceStore(panelStore as never, createSessionStoreStub() as never);

		const restoredSessionIds = store.restore({
			version: 9,
			panels: [
				{
					id: "auto-panel",
					sessionId: "auto-session",
					autoCreated: true,
					width: 640,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/workspace/app",
					agentId: "claude-code",
				},
				{
					id: "durable-panel",
					sessionId: "durable-session",
					width: 640,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/workspace/app",
					agentId: "claude-code",
				},
			],
			focusedPanelIndex: 0,
			panelContainerScrollX: 0,
			savedAt: new Date().toISOString(),
		});

		expect(restoredSessionIds).toEqual(["durable-session"]);
		expect(panelStore.panels).toHaveLength(1);
		expect(panelStore.panels[0]).toMatchObject({ sessionId: "durable-session" });
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

	it("persists from workspace panel indexes without rebuilding panel lists", () => {
		const panelStore = createPanelStoreStub();
		panelStore.workspacePanels = [
			{
				id: "agent-1",
				kind: "agent",
				sessionId: "session-1",
				width: 500,
				ownerPanelId: null,
				projectPath: "/workspace/app",
				pendingProjectSelection: null,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: null,
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: "Session",
			},
			{
				id: "file-1",
				kind: "file",
				filePath: "src/app.ts",
				projectPath: "/workspace/app",
				ownerPanelId: "agent-1",
				width: 420,
			},
		] as WorkspacePanel[];
		Object.defineProperty(panelStore, "panels", {
			get() {
				throw new Error("must not rebuild agent panels while persisting");
			},
		});
		Object.defineProperty(panelStore, "filePanels", {
			get() {
				throw new Error("must not rebuild file panels while persisting");
			},
		});
		const store = new WorkspaceStore(panelStore as never, createSessionStoreStub() as never);

		store.persist(true);

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		const savedState = saveWorkspaceStateMock.mock.calls[0]?.[0] as
			| Record<string, unknown>
			| undefined;
		expect(savedState?.workspacePanels).toHaveLength(2);
		expect(savedState?.filePanels).toEqual([
			expect.objectContaining({ id: "file-1", filePath: "src/app.ts" }),
		]);
	});

	it("does not persist auto-created session panels", () => {
		const panelStore = createPanelStoreStub();
		panelStore.workspacePanels = [
			{
				id: "auto-panel",
				kind: "agent",
				sessionId: "auto-session",
				autoCreated: true,
				width: 640,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				projectPath: "/workspace/app",
				agentId: "claude-code",
				ownerPanelId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: "Auto session",
			},
			{
				id: "durable-panel",
				kind: "agent",
				sessionId: "durable-session",
				width: 640,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				projectPath: "/workspace/app",
				agentId: "claude-code",
				ownerPanelId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: "Durable session",
			},
		];
		panelStore.panels = [
			{
				id: "auto-panel",
				kind: "agent",
				sessionId: "auto-session",
				autoCreated: true,
				width: 640,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				projectPath: "/workspace/app",
				agentId: "claude-code",
				ownerPanelId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: "Auto session",
			},
			{
				id: "durable-panel",
				kind: "agent",
				sessionId: "durable-session",
				width: 640,
				pendingProjectSelection: false,
				selectedAgentId: "claude-code",
				projectPath: "/workspace/app",
				agentId: "claude-code",
				ownerPanelId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: "Durable session",
			},
		] as Panel[];
		const store = new WorkspaceStore(panelStore as never, createSessionStoreStub() as never);

		store.persist(true);

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		const calls = saveWorkspaceStateMock.mock.calls as Array<ReadonlyArray<unknown>>;
		const savedState = calls[0]?.[0] as {
			workspacePanels?: Array<Record<string, unknown>>;
			panels?: Array<Record<string, unknown>>;
		};
		expect(savedState.workspacePanels?.map((panel) => panel.id)).toEqual(["durable-panel"]);
		expect(savedState.panels?.map((panel) => panel.id)).toEqual(["durable-panel"]);
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
		expect("terminalPanels" in savedState).toBe(false);
	});

	it("persists and restores worktree session context", () => {
		const panelStore = createPanelStoreStub();
		const workspacePanels = [
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
		panelStore.panels = workspacePanels;
		panelStore.workspacePanels = workspacePanels;

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
