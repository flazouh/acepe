import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		resetZoom: vi.fn(),
		zoomLevel: 1,
		zoomPercentage: "100%",
	}),
}));

import type { WorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { SelectorRegistry } from "$lib/acp/logic/selector-registry.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { PreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

function createState(options?: {
	focusedPanelProjectPath?: string | null;
	focusedViewProjectPath?: string | null;
	projects?: Array<{ path: string; name: string }>;
}) {
	const workspaceStore = {
		registerProviders: vi.fn(),
		persist: vi.fn(),
	} as Partial<WorkspaceStore>;

	const keybindingsService = {
		upsertAction: vi.fn(),
	} as Partial<KeybindingsService>;

	const panelStore = {
		fullscreenPanelId: null,
		isPanelInReviewMode: vi.fn(() => false),
		focusedPanel: options?.focusedPanelProjectPath
			? { projectPath: options.focusedPanelProjectPath }
			: null,
		focusedViewProjectPath: options?.focusedViewProjectPath ? options.focusedViewProjectPath : null,
		focusedPanelId: null,
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
		getPanel: vi.fn((panelId: string) =>
			panelId === "panel-1" ? { id: "panel-1", reviewMode: false } : undefined
		),
		panels: [
			{
				id: "panel-1",
				kind: "agent",
				ownerPanelId: null,
				sessionId: null,
				width: 100,
				pendingProjectSelection: false,
				selectedAgentId: null,
				projectPath: null,
				agentId: null,
				sessionTitle: null,
			},
		],
	} as Partial<PanelStore>;

	const projectManager = {
		projects: options?.projects ? options.projects : [],
		projectCount: options?.projects ? options.projects.length : 0,
	} as Partial<ProjectManager>;

	const selectorRegistry = {
		toggleFocused: vi.fn(),
		cycleFocused: vi.fn(),
	} as Partial<SelectorRegistry>;

	const preconnectionAgentSkillsStore = {
		initialize: vi.fn(),
		ensureLoaded: vi.fn(),
		refresh: vi.fn(),
	} as Partial<PreconnectionAgentSkillsStore>;

	const state = new MainAppViewState(
		{} as SessionStore,
		panelStore as PanelStore,
		{} as AgentStore,
		{} as ConnectionStore,
		workspaceStore as WorkspaceStore,
		projectManager as ProjectManager,
		{} as AgentPreferencesStore,
		keybindingsService as KeybindingsService,
		selectorRegistry as SelectorRegistry,
		{} as WorktreeDefaultStore,
		preconnectionAgentSkillsStore as PreconnectionAgentSkillsStore
	);

	return { state, workspaceStore, panelStore, projectManager };
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
		expect(panelStore.switchFullscreen).toHaveBeenCalledWith("panel-1");
		expect(panelStore.viewMode).toBe("single");
		expect(panelStore.fullscreenPanelId).toBe("panel-1");
	});

	it("restores the prior card mode when leaving single mode", () => {
		const { state, panelStore } = createState();

		state.handleToggleFullscreen("panel-1");
		state.handleToggleFullscreen("panel-1");

		expect(panelStore.setViewMode).toHaveBeenLastCalledWith("project");
		expect(panelStore.viewMode).toBe("project");
		expect(panelStore.fullscreenPanelId).toBeNull();
	});
});
