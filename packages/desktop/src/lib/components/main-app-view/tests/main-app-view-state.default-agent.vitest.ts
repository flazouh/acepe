import { okAsync } from "neverthrow";
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

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

import type { WorktreeDefaultStore } from "$lib/acp/components/worktree/worktree-default-store.svelte.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { SelectorRegistry } from "$lib/acp/logic/selector-registry.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionProjectionHydrator } from "$lib/acp/store/services/session-projection-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { AgentWorkspacePanel } from "$lib/acp/store/types.js";
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

function createState(options: {
	defaultAgentId: string | null;
	availableAgents: Array<{ id: string }>;
}) {
	const panelStore = {
		fullscreenPanelId: null,
		toggleFullscreen: vi.fn(),
		isPanelInReviewMode: vi.fn(() => false),
		setPanelAgent: vi.fn(),
		spawnPanel: vi.fn(() => createAgentPanel("/repo")),
		focusedTopLevelPanel: null,
		focusedPanel: null,
		focusedViewProjectPath: null,
		focusedPanelId: null,
		workspacePanels: [],
		viewMode: "project",
		setViewMode: vi.fn(),
		switchFullscreen: vi.fn(),
		focusPanel: vi.fn(),
		getTopLevelPanel: vi.fn(),
		getPanel: vi.fn(),
		panels: [],
	} as unknown as PanelStore;

	const projectManager = {
		projects: [{ path: "/repo", name: "Repo" }],
		projectCount: 1,
	} as Partial<ProjectManager>;

	const agentPreferencesStore = {
		selectedAgentIds: [],
		defaultAgentId: options.defaultAgentId,
		setSelectedAgentIds: vi.fn(() => okAsync(undefined)),
	} as Partial<AgentPreferencesStore>;

	const agentStore = {
		agents: options.availableAgents,
	} as unknown as AgentStore;

	const workspaceStore = {
		registerProviders: vi.fn(),
		persist: vi.fn(),
	} as Partial<WorkspaceStore>;

	const keybindingsService = { upsertAction: vi.fn() } as Partial<KeybindingsService>;
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
	const sessionOpenHydrator = {
		beginAttempt: vi.fn(() => "request-1"),
		clearAttempt: vi.fn(),
		hydrateFound: vi.fn(() => okAsync(undefined)),
		isCurrentAttempt: vi.fn(() => true),
	} as unknown as Pick<
		SessionOpenHydrator,
		"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
	>;

	const state = new MainAppViewState(
		{} as SessionStore,
		panelStore,
		agentStore,
		{} as ConnectionStore,
		workspaceStore as WorkspaceStore,
		projectManager as ProjectManager,
		agentPreferencesStore as AgentPreferencesStore,
		keybindingsService as KeybindingsService,
		selectorRegistry as SelectorRegistry,
		{} as WorktreeDefaultStore,
		preconnectionAgentSkillsStore as PreconnectionAgentSkillsStore,
		sessionOpenHydrator,
		projectionHydrator
	);

	return { state, panelStore };
}

describe("MainAppViewState handleNewThreadForProject default agent resolution", () => {
	it("uses the preferred default agent when no explicit agent is provided", () => {
		const { state, panelStore } = createState({
			defaultAgentId: "copilot",
			availableAgents: [{ id: "claude-code" }, { id: "copilot" }],
		});

		state.handleNewThreadForProject("/repo");

		expect(panelStore.spawnPanel).toHaveBeenCalled();
		expect(panelStore.setPanelAgent).toHaveBeenCalledWith("panel-1", "copilot");
	});

	it("falls back to the first available agent when no default preference is set", () => {
		const { state, panelStore } = createState({
			defaultAgentId: null,
			availableAgents: [{ id: "claude-code" }, { id: "copilot" }],
		});

		state.handleNewThreadForProject("/repo");

		expect(panelStore.setPanelAgent).toHaveBeenCalledWith("panel-1", "claude-code");
	});

	it("falls back to first available agent when defaultAgentId points to an unknown agent", () => {
		const { state, panelStore } = createState({
			defaultAgentId: "nonexistent",
			availableAgents: [{ id: "claude-code" }, { id: "copilot" }],
		});

		state.handleNewThreadForProject("/repo");

		expect(panelStore.setPanelAgent).toHaveBeenCalledWith("panel-1", "claude-code");
	});

	it("does not set a panel agent when there are no available agents", () => {
		const { state, panelStore } = createState({
			defaultAgentId: null,
			availableAgents: [],
		});

		state.handleNewThreadForProject("/repo");

		expect(panelStore.spawnPanel).toHaveBeenCalled();
		expect(panelStore.setPanelAgent).not.toHaveBeenCalled();
	});
});
