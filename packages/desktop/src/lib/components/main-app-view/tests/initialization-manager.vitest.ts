import { beforeEach, describe, expect, it, vi } from "vitest";
import { errAsync, ok, okAsync } from "neverthrow";
import { AgentError } from "../../../acp/errors/app-error";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { PreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";

vi.mock("$lib/services/zoom.svelte.js", () => ({
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

function buildSession(id: string, agentId: string, projectPath: string, title: string) {
	return {
		id,
		projectPath,
		agentId,
		title,
		createdAt: new Date(),
		updatedAt: new Date(),
		parentId: null,
	};
}

describe("InitializationManager", () => {
	let mockState: MainAppViewState;
	let mockSessionStore: SessionStore;
	let mockAgentStore: AgentStore;
	let mockPanelStore: PanelStore;
	let mockWorkspaceStore: WorkspaceStore;
	let mockProjectManager: ProjectManager;
	let mockAgentPreferencesStore: AgentPreferencesStore;
	let mockKeybindingsService: KeybindingsService;
	let mockPreconnectionAgentSkillsStore: PreconnectionAgentSkillsStore;
	let manager: InitializationManager;

	beforeEach(() => {
		// Mock window for keybindings service
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				addEventListener: vi.fn(() => {}),
				removeEventListener: vi.fn(() => {}),
			},
		});

		// Create mocks
		mockState = {
			debugPanelOpen: false,
			settingsModalOpen: false,
			commandPaletteOpen: false,
			initializationInProgress: false,
			initializationComplete: false,
			initializationError: null,
		} as MainAppViewState;

		const sessionStoreMock: Partial<SessionStore> = {
			initializeSessionUpdates: vi.fn(() => okAsync(undefined)),
			loadSessions: vi.fn(() => okAsync([])),
			loadStartupSessions: vi.fn(() => okAsync({ missing: [] })),
			preloadSessions: vi.fn(() => okAsync({ loaded: [], missing: [] })),
			loadSessionById: vi.fn(() =>
				okAsync(buildSession("session-1", "claude-code", "/project1", "Session 1"))
			),
			isPreloaded: vi.fn(() => false),
			connectSession: vi.fn(() =>
				okAsync(buildSession("session-1", "claude-code", "/project1", "Session 1"))
			),
			scanSessions: vi.fn(() => okAsync(undefined)),
			createSession: vi.fn((options) =>
				okAsync(
					buildSession(
						"session-1",
						options.agentId,
						options.projectPath,
						options.title ? options.title : "New Thread"
					)
				)
			),
			getSessionCold: vi.fn(() => undefined),
		};
		mockSessionStore = sessionStoreMock as SessionStore;

		const agentStoreMock: Partial<AgentStore> = {
			loadAvailableAgents: vi.fn(() => okAsync([])),
		};
		mockAgentStore = agentStoreMock as AgentStore;

		const panelStoreMock: Partial<PanelStore> = {
			panels: [],
			updatePanelSession: vi.fn(() => {}),
			closePanelBySessionId: vi.fn(() => {}),
			clearPanels: vi.fn(() => {}),
		};
		mockPanelStore = panelStoreMock as PanelStore;

		const workspaceStoreMock: Partial<WorkspaceStore> = {
			load: vi.fn(() =>
				okAsync({
					version: 1,
					panels: [],
					focusedPanelIndex: null,
					panelContainerScrollX: 0,
					savedAt: new Date().toISOString(),
				})
			),
			restore: vi.fn(() => []),
		};
		mockWorkspaceStore = workspaceStoreMock as WorkspaceStore;

		const projectManagerMock: Partial<ProjectManager> = {
			projects: [],
			projectCount: 0,
			loadProjects: vi.fn(() => okAsync(undefined)),
		};
		mockProjectManager = projectManagerMock as ProjectManager;

		const agentPreferencesStoreMock: Partial<AgentPreferencesStore> = {
			initialize: vi.fn(() => okAsync(undefined)),
		};
		mockAgentPreferencesStore = agentPreferencesStoreMock as AgentPreferencesStore;

		const keybindingsServiceMock: Partial<KeybindingsService> = {
			initialize: vi.fn(() => ok(undefined)),
			upsertAction: vi.fn(() => {}),
			install: vi.fn(() => ok(undefined)),
			loadUserKeybindings: vi.fn(() => okAsync(undefined)),
			reinstall: vi.fn(() => ok(undefined)),
			uninstall: vi.fn(() => ok(undefined)),
		};
		mockKeybindingsService = keybindingsServiceMock as KeybindingsService;

		const preconnectionAgentSkillsStoreMock: Partial<PreconnectionAgentSkillsStore> = {
			initialize: vi.fn(() => okAsync(undefined)),
			ensureLoaded: vi.fn(() => okAsync(undefined)),
			refresh: vi.fn(() => okAsync(undefined)),
		};
		mockPreconnectionAgentSkillsStore =
			preconnectionAgentSkillsStoreMock as PreconnectionAgentSkillsStore;

		manager = new InitializationManager(
			mockState,
			mockSessionStore,
			mockAgentStore,
			mockPanelStore,
			mockWorkspaceStore,
			mockProjectManager,
			mockAgentPreferencesStore,
			mockKeybindingsService,
			mockPreconnectionAgentSkillsStore
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

		it("should load keybindings, agents, projects, and preconnection skills in parallel", async () => {
			await manager.initialize();
			expect(mockKeybindingsService.loadUserKeybindings).toHaveBeenCalled();
			expect(mockAgentStore.loadAvailableAgents).toHaveBeenCalled();
			expect(mockProjectManager.loadProjects).toHaveBeenCalled();
			expect(mockPreconnectionAgentSkillsStore.initialize).toHaveBeenCalled();
		});

		it("should initialize agent preferences after loading metadata", async () => {
			await manager.initialize();
			expect(mockAgentPreferencesStore.initialize).toHaveBeenCalled();
		});

		it("continues startup when preconnection skills warming fails", async () => {
			mockPreconnectionAgentSkillsStore.initialize = vi.fn(() =>
				errAsync(new AgentError("skills_list_agent_skills", new Error("Failed")))
			) as PreconnectionAgentSkillsStore["initialize"];

			const result = await manager.initialize();

			expect(result.isOk()).toBe(true);
			expect(mockState.initializationComplete).toBe(true);
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
			mockPanelStore.updatePanelSession = vi.fn((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) =>
					panel.id === panelId
						? {
							id: panel.id,
							kind: panel.kind,
							ownerPanelId: panel.ownerPanelId,
							sessionId,
							width: panel.width,
							pendingProjectSelection: panel.pendingProjectSelection,
							selectedAgentId: panel.selectedAgentId,
							projectPath: panel.projectPath,
							agentId: panel.agentId,
							sessionTitle: panel.sessionTitle,
						}
						: panel
				);
			});
			await manager.initialize();

			expect(mockSessionStore.loadSessions).toHaveBeenCalledWith(["/project1"]);
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", null);
			expect(mockSessionStore.loadSessionById).not.toHaveBeenCalled();
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
		});

		it("preloads restored sessions using stored session metadata when panel metadata is missing", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "cursor",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];
			mockSessionStore.getSessionCold = vi.fn((sessionId: string) =>
				sessionId === "session-1"
					? {
						id: "session-1",
						projectPath: "/project1",
						agentId: "cursor",
						title: "Recovered session",
						createdAt: new Date(),
						updatedAt: new Date(),
						parentId: null,
					}
					: undefined
			);

			await manager.initialize();

			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/project1",
				"cursor",
				undefined,
				undefined,
				"Recovered session"
			);
			expect(mockSessionStore.connectSession).toHaveBeenCalledWith("session-1");
		});

		it("preloads restored sessions with persisted worktree context", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Feature thread",
					sourcePath: "/project1/.cursor/sessions/session-1.json",
					worktreePath: "/project1/.git/worktrees/feature-a",
				},
			];

			await manager.initialize();

			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/project1",
				"claude-code",
				"/project1/.cursor/sessions/session-1.json",
				"/project1/.git/worktrees/feature-a",
				"Feature thread"
			);
			expect(mockSessionStore.connectSession).toHaveBeenCalledWith("session-1");
		});

		it("should handle initialization errors", async () => {
			mockAgentStore.loadAvailableAgents = vi.fn(() =>
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
