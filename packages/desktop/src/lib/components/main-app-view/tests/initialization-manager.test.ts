import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { AgentError } from "$lib/acp/errors/app-error.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";

// Mock the zoom service module to avoid $state runtime issues
mock.module("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		initialize: () => okAsync(undefined),
		zoomIn: () => okAsync(undefined),
		zoomOut: () => okAsync(undefined),
		resetZoom: () => okAsync(undefined),
		zoomLevel: 1.0,
		zoomPercentage: "100%",
	}),
	resetZoomService: () => {},
}));

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

import { InitializationManager } from "../logic/managers/initialization-manager.js";

type TestPanel = {
	id: string;
	kind: "agent";
	ownerPanelId: null;
	sessionId: string | null;
	width: number;
	pendingProjectSelection: boolean;
	selectedAgentId: string;
	projectPath: string;
	agentId: string;
	sessionTitle: string;
};

describe("InitializationManager", () => {
	let mockState: MainAppViewState;
	let mockSessionStore: SessionStore;
	let mockAgentStore: AgentStore;
	let mockPanelStore: PanelStore;
	let mockWorkspaceStore: WorkspaceStore;
	let mockProjectManager: ProjectManager;
	let mockAgentPreferencesStore: AgentPreferencesStore;
	let mockKeybindingsService: KeybindingsService;
	let manager: InitializationManager;

	beforeEach(() => {
		// Mock window for keybindings service
		global.window = {
			addEventListener: mock(() => {}),
			removeEventListener: mock(() => {}),
		} as unknown as Window & typeof globalThis;

		// Create mocks
		mockState = {
			debugPanelOpen: false,
			settingsModalOpen: false,
			commandPaletteOpen: false,
			initializationInProgress: false,
			initializationComplete: false,
			initializationError: null,
		} as unknown as MainAppViewState;

		mockSessionStore = {
			initializeSessionUpdates: mock(() => okAsync(undefined)),
			loadSessions: mock(() => okAsync([])),
			loadStartupSessions: mock(() => okAsync({ missing: [] })),
			preloadSessions: mock(() => okAsync({ loaded: [], missing: [] })),
			loadSessionById: mock(() => okAsync({ id: "session-1" })),
			isPreloaded: mock(() => false),
			connectSession: mock(() => okAsync({})),
			scanSessions: mock(() => okAsync(undefined)),
			createSession: mock(() => okAsync({ id: "session-1" })),
			getSessionCold: mock(() => undefined),
		} as unknown as SessionStore;

		mockAgentStore = {
			loadAvailableAgents: mock(() => okAsync([])),
		} as unknown as AgentStore;

		mockPanelStore = {
			panels: [],
			updatePanelSession: mock(() => {}),
			closePanelBySessionId: mock(() => {}),
			clearPanels: mock(() => {}),
		} as unknown as PanelStore;

		mockWorkspaceStore = {
			load: mock(() =>
				okAsync({
					version: 1,
					panels: [],
					focusedPanelIndex: null,
					panelContainerScrollX: 0,
					savedAt: new Date().toISOString(),
				})
			),
			restore: mock(() => []),
		} as unknown as WorkspaceStore;

		mockProjectManager = {
			recentProjects: [],
			projects: [],
			projectCount: 0,
			loadProjects: mock(() => okAsync(undefined)),
		} as unknown as ProjectManager;

		mockAgentPreferencesStore = {
			initialize: mock(() => okAsync(undefined)),
		} as unknown as AgentPreferencesStore;

		mockKeybindingsService = {
			initialize: mock(() => ({ isOk: () => true, isErr: () => false })),
			upsertAction: mock(() => {}),
			install: mock(() => {}),
			loadUserKeybindings: mock(() => okAsync(undefined)),
			reinstall: mock(() => {}),
			uninstall: mock(() => {}),
		} as unknown as KeybindingsService;

		manager = new InitializationManager(
			mockState,
			mockSessionStore,
			mockAgentStore,
			mockPanelStore,
			mockWorkspaceStore,
			mockProjectManager,
			mockAgentPreferencesStore,
			mockKeybindingsService
		);
	});

	describe("initialize", () => {
		it("should set initializationInProgress to true at start", async () => {
			const result = manager.initialize();
			expect(mockState.initializationInProgress).toBe(true);
			await result;
		});

		it("should set initializationComplete to true on success", async () => {
			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockState.initializationComplete).toBe(true);
			expect(mockState.initializationInProgress).toBe(false);
		});

		it("should initialize keybindings service", async () => {
			await manager.initialize();
			expect(mockKeybindingsService.initialize).toHaveBeenCalled();
		});

		// Note: Keybinding actions are registered by KeybindingManager, not InitializationManager
		// This is tested in keybinding-manager.test.ts

		it("should install keybindings on window", async () => {
			await manager.initialize();
			expect(mockKeybindingsService.install).toHaveBeenCalledWith(window);
		});

		it("should initialize session updates", async () => {
			await manager.initialize();
			expect(mockSessionStore.initializeSessionUpdates).toHaveBeenCalled();
		});

		it("should load keybindings, agents, and projects in parallel", async () => {
			await manager.initialize();
			expect(mockKeybindingsService.loadUserKeybindings).toHaveBeenCalled();
			expect(mockAgentStore.loadAvailableAgents).toHaveBeenCalled();
			expect(mockProjectManager.loadProjects).toHaveBeenCalled();
		});

		it("should initialize agent preferences after loading metadata", async () => {
			await manager.initialize();
			expect(mockAgentPreferencesStore.initialize).toHaveBeenCalled();
		});

		it("should restore workspace state", async () => {
			await manager.initialize();
			expect(mockWorkspaceStore.restore).toHaveBeenCalled();
		});

		it("should load sessions for project paths", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			await manager.initialize();
			expect(mockSessionStore.loadSessions).toHaveBeenCalledWith(["/project1"]);
		});

		it("clears orphaned restored session ids before attempting startup reconnect", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "missing-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Old Session",
				},
			];
			Object.defineProperty(mockPanelStore, "panels", {
				configurable: true,
				get: () => currentPanels,
			});
			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) =>
					panel.id === panelId ? { ...panel, sessionId } : panel
				);
			});
			await manager.initialize();

			expect(mockSessionStore.loadSessions).toHaveBeenCalledWith(["/project1"]);
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", null);
			expect(mockSessionStore.loadSessionById).not.toHaveBeenCalled();
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
		});

		it("should handle initialization errors", async () => {
			mockAgentStore.loadAvailableAgents = mock(() =>
				errAsync(new AgentError("loadAgents", new Error("Failed")))
			);
			const result = await manager.initialize();
			expect(result.isErr()).toBe(true);
			expect(mockState.initializationComplete).toBe(false);
		});

		it("should skip startup session auto-creation for opencode panels", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "opencode",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			await manager.initialize();

			expect(mockSessionStore.createSession).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();
		});

		it("should keep startup session auto-creation for non-opencode panels", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			await manager.initialize();

			expect(mockSessionStore.createSession).toHaveBeenCalledWith({
				agentId: "claude-code",
				projectPath: "/project1",
			});
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", "session-1");
		});

		it("should not initialize if already in progress", async () => {
			mockState.initializationInProgress = true;
			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockKeybindingsService.initialize).not.toHaveBeenCalled();
		});

		it("should not initialize if already complete", async () => {
			mockState.initializationComplete = true;
			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockKeybindingsService.initialize).not.toHaveBeenCalled();
		});
	});

	describe("cleanup", () => {
		it("should uninstall keybindings", () => {
			manager.cleanup();
			expect(mockKeybindingsService.uninstall).toHaveBeenCalled();
		});

		it("should reset initialization flags", () => {
			mockState.initializationInProgress = true;
			mockState.initializationComplete = true;
			manager.cleanup();
			expect(mockState.initializationInProgress).toBe(false);
			expect(mockState.initializationComplete).toBe(false);
		});
	});
});
