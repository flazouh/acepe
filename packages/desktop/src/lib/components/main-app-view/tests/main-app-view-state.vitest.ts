import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const openUrlMock = vi.fn();

vi.mock("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		resetZoom: vi.fn(),
		zoomLevel: 1,
		zoomPercentage: "100%",
	}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: openUrlMock,
}));

import type { WorktreeDefaultStore } from "$lib/acp/components/worktree/worktree-default-store.svelte.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { SelectorRegistry } from "$lib/acp/logic/selector-registry.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionProjectionHydrator } from "$lib/acp/store/services/session-projection-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { AgentWorkspacePanel, TerminalWorkspacePanel } from "$lib/acp/store/types.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { PreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

function createAgentPanel(projectPath: string | null): AgentWorkspacePanel {
	return {
		id: "panel-1",
		kind: "agent",
		ownerPanelId: null,
		sessionId: null,
		width: 100,
		pendingProjectSelection: false,
		selectedAgentId: null,
		projectPath,
		agentId: null,
		sessionTitle: null,
	};
}

function createTerminalPanel(projectPath: string): TerminalWorkspacePanel {
	return {
		id: "terminal-1",
		kind: "terminal",
		projectPath,
		width: 100,
		ownerPanelId: null,
		groupId: "terminal-group-1",
	};
}

function createState(options?: {
	focusedPanelProjectPath?: string | null;
	focusedViewProjectPath?: string | null;
	projects?: Array<{ path: string; name: string }>;
	selectedAgentIds?: string[];
	setSelectedAgentIds?: ReturnType<typeof vi.fn>;
}) {
	const agentPanel = createAgentPanel(null);
	const focusedTopLevelPanel = options?.focusedPanelProjectPath
		? createAgentPanel(options.focusedPanelProjectPath)
		: null;
	const terminalPanel = createTerminalPanel("/repo");

	const workspaceStore = {
		registerProviders: vi.fn(),
		persist: vi.fn(),
	} as Partial<WorkspaceStore>;

	const keybindingsService = {
		upsertAction: vi.fn(),
	} as Partial<KeybindingsService>;

	const panelStore = {
		fullscreenPanelId: null,
		toggleFullscreen: vi.fn(),
		isPanelInReviewMode: vi.fn(() => false),
		setPanelAgent: vi.fn(),
		spawnPanel: vi.fn(() => createAgentPanel("/repo")),
		focusedTopLevelPanel,
		focusedPanel: options?.focusedPanelProjectPath
			? { projectPath: options.focusedPanelProjectPath }
			: null,
		focusedViewProjectPath: options?.focusedViewProjectPath ? options.focusedViewProjectPath : null,
		focusedPanelId: null,
		workspacePanels: [agentPanel],
		viewMode: "project",
		setViewMode: vi.fn((mode: "single" | "project" | "multi") => {
			panelStore.viewMode = mode;
			panelStore.fullscreenPanelId = null;
		}),
		switchFullscreen: vi.fn((panelId: string) => {
			panelStore.fullscreenPanelId = panelId;
		}),
		focusPanel: vi.fn((panelId: string) => {
			panelStore.focusedPanelId = panelId;
		}),
		getTopLevelPanel: vi.fn((panelId: string) =>
			panelId === "panel-1"
				? (focusedTopLevelPanel ?? agentPanel)
				: panelId === "terminal-1"
					? terminalPanel
					: undefined
		),
		getPanel: vi.fn((panelId: string) =>
			panelId === "panel-1" ? { id: "panel-1", reviewMode: false } : undefined
		),
		panels: [agentPanel],
	} as Partial<PanelStore>;

	const projectManager = {
		projects: options?.projects ? options.projects : [],
		projectCount: options?.projects ? options.projects.length : 0,
	} as Partial<ProjectManager>;

	const agentPreferencesStore = {
		selectedAgentIds: options?.selectedAgentIds ? options.selectedAgentIds : [],
		setSelectedAgentIds: options?.setSelectedAgentIds
			? options.setSelectedAgentIds
			: vi.fn(() => okAsync(undefined)),
	} as Partial<AgentPreferencesStore>;

	const selectorRegistry = {
		toggleFocused: vi.fn(),
		cycleFocused: vi.fn(),
	} as Partial<SelectorRegistry>;

	const preconnectionAgentSkillsStore = {
		initialize: vi.fn(),
		ensureLoaded: vi.fn(),
		refresh: vi.fn(),
	} as Partial<PreconnectionAgentSkillsStore>;

	const projectionHydrator = {
		hydrateSession: vi.fn(() => okAsync(undefined)),
		clearSession: vi.fn(),
	} as Pick<SessionProjectionHydrator, "hydrateSession" | "clearSession">;

	const state = new MainAppViewState(
		{} as SessionStore,
		panelStore as PanelStore,
		{} as AgentStore,
		{} as ConnectionStore,
		workspaceStore as WorkspaceStore,
		projectManager as ProjectManager,
		agentPreferencesStore as AgentPreferencesStore,
		keybindingsService as KeybindingsService,
		selectorRegistry as SelectorRegistry,
		{} as WorktreeDefaultStore,
		preconnectionAgentSkillsStore as PreconnectionAgentSkillsStore,
		projectionHydrator
	);

	return { state, workspaceStore, panelStore, projectManager, agentPreferencesStore };
}

describe("MainAppViewState file explorer", () => {
	it("opens when the focused panel provides project context even without loaded projects", () => {
		const { state } = createState({ focusedPanelProjectPath: "/repo" });

		state.openFileExplorer();

		expect(state.fileExplorerOpen).toBe(true);
		expect(state.fileExplorerVisible).toBe(true);
	});

	it("does not open when there is no project context at all", () => {
		const { state } = createState();

		state.openFileExplorer();

		expect(state.fileExplorerOpen).toBe(false);
		expect(state.fileExplorerVisible).toBe(false);
	});

	it("treats single mode as fullscreen for the shell", () => {
		const { state, panelStore } = createState();

		expect(state.isFullscreen).toBe(false);

		panelStore.viewMode = "single";

		expect(state.isFullscreen).toBe(true);
	});

	it("enters single mode when toggling session fullscreen", () => {
		const { state, panelStore } = createState();

		state.handleToggleFullscreen("panel-1");

		expect(panelStore.focusPanel).toHaveBeenCalledWith("panel-1");
		expect(panelStore.setViewMode).toHaveBeenCalledWith("single");
		expect(panelStore.switchFullscreen).not.toHaveBeenCalled();
		expect(panelStore.viewMode).toBe("single");
		expect(panelStore.fullscreenPanelId).toBeNull();
	});

	it("restores the prior card mode when leaving single mode", () => {
		const { state, panelStore } = createState();

		state.handleToggleFullscreen("panel-1");
		state.handleToggleFullscreen("panel-1");

		expect(panelStore.setViewMode).toHaveBeenLastCalledWith("project");
		expect(panelStore.viewMode).toBe("project");
		expect(panelStore.fullscreenPanelId).toBeNull();
	});

	it("enters single mode when toggling fullscreen for a non-agent top-level panel", () => {
		const { state, panelStore } = createState();

		state.handleToggleFullscreen("terminal-1");

		expect(panelStore.switchFullscreen).not.toHaveBeenCalled();
		expect(panelStore.focusPanel).toHaveBeenCalledWith("terminal-1");
		expect(panelStore.setViewMode).toHaveBeenCalledWith("single");
		expect(panelStore.viewMode).toBe("single");
	});

	it("persists an unselected panel agent so install-on-send agents stay visible", () => {
		const setSelectedAgentIds = vi.fn(() => okAsync(undefined));
		const { state, panelStore } = createState({
			selectedAgentIds: ["claude-code"],
			setSelectedAgentIds,
		});

		state.handlePanelAgentChange("panel-1", "cursor");

		expect(panelStore.setPanelAgent).toHaveBeenCalledWith("panel-1", "cursor");
		expect(setSelectedAgentIds).toHaveBeenCalledWith(["claude-code", "cursor"]);
	});

	it("does not rewrite selected agents when the panel agent is already selected", () => {
		const setSelectedAgentIds = vi.fn(() => okAsync(undefined));
		const { state, panelStore } = createState({
			selectedAgentIds: ["claude-code", "cursor"],
			setSelectedAgentIds,
		});

		state.handlePanelAgentChange("panel-1", "cursor");

		expect(panelStore.setPanelAgent).toHaveBeenCalledWith("panel-1", "cursor");
		expect(setSelectedAgentIds).not.toHaveBeenCalled();
	});

	it("routes project-scoped thread creation through the override when one is registered", () => {
		const { state, panelStore } = createState({
			projects: [{ path: "/repo", name: "Repo" }],
		});
		const override = vi.fn();
		state.onNewThreadOverride = override;

		state.handleNewThreadForProject("/repo", "cursor");

		expect(override).toHaveBeenCalledWith({
			projectPath: "/repo",
			agentId: "cursor",
		});
		expect(panelStore.spawnPanel).not.toHaveBeenCalled();
	});

	it("opens issue drafts with the system browser opener", () => {
		const { state } = createState();
		openUrlMock.mockReset();
		openUrlMock.mockResolvedValue(undefined);
		const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		state.openUserReportsWithDraft({
			title: "Bug report",
			body: "Line 1\nLine 2",
			category: "bug",
			referenceId: null,
			referenceSearchable: false,
			issueNumber: null,
			issueUrl: null,
			surface: null,
			diagnosticsSummary: null,
		});

		expect(openUrlMock).toHaveBeenCalledWith(
			"https://github.com/flazouh/acepe/issues/new?title=Bug+report&body=Line+1%0ALine+2&labels=bug"
		);
		expect(windowOpenSpy).not.toHaveBeenCalled();

		windowOpenSpy.mockRestore();
	});
});
