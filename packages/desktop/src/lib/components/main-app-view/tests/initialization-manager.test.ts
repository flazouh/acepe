import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { AgentError } from "$lib/acp/errors/app-error.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionCold } from "$lib/acp/application/dto/session-cold.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { PreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";

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
	projectPath: string | null;
	agentId: string | null;
	sessionTitle: string | null;
	sourcePath?: string | null;
	worktreePath?: string | null;
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
		globalThis.window = {
			addEventListener: mock(() => {}),
			removeEventListener: mock(() => {}),
		} as unknown as Window & typeof globalThis;

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
			loadSessionById: mock(() =>
				okAsync(buildSession("session-1", "claude-code", "/project1", "Session 1"))
			),
			isPreloaded: mock(() => false),
			connectSession: mock(() =>
				okAsync(buildSession("session-1", "claude-code", "/project1", "Session 1"))
			),
			scanSessions: mock(() => okAsync(undefined)),
			createSession: mock((options: { agentId: string; projectPath: string; title?: string }) =>
				okAsync(
					buildSession(
						"session-1",
						options.agentId,
						options.projectPath,
						options.title ? options.title : "New Thread"
					)
				)
			),
			setSessions: mock(() => {}),
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

		mockPreconnectionAgentSkillsStore = {
			initialize: mock(() => okAsync(undefined)),
			ensureLoaded: mock(() => okAsync(undefined)),
			refresh: mock(() => okAsync(undefined)),
		} as unknown as PreconnectionAgentSkillsStore;

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
			mockPreconnectionAgentSkillsStore.initialize = mock(() =>
				errAsync(new AgentError("skills_list_agent_skills", new Error("Failed")))
			) as PreconnectionAgentSkillsStore["initialize"];

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
			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
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
							sourcePath: panel.sourcePath,
							worktreePath: panel.worktreePath,
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
			mockSessionStore.getSessionCold = mock((sessionId: string) =>
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

		it("does not clear a restored worktree session when history contains it", async () => {
			mockProjectManager.projects = [
				{ path: "/Users/alex/Documents/acepe", name: "acepe", createdAt: new Date(), color: "blue" },
			];

			let storedSessions: SessionCold[] = [
				buildSession(
					"session-1",
					"claude-code",
					"/Users/alex/Documents/acepe",
					"Feature thread"
				),
			];
			storedSessions[0] = {
				id: storedSessions[0].id,
				projectPath: storedSessions[0].projectPath,
				agentId: storedSessions[0].agentId,
				title: storedSessions[0].title,
				createdAt: storedSessions[0].createdAt,
				updatedAt: storedSessions[0].updatedAt,
				parentId: storedSessions[0].parentId,
				worktreePath: "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean",
			};

			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/Users/alex/Documents/acepe",
					agentId: "claude-code",
					sessionTitle: "Feature thread",
					worktreePath: "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean",
				},
			];

			Object.defineProperty(mockPanelStore, "panels", {
				configurable: true,
				get: () => currentPanels,
			});

			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) => {
					if (panel.id === panelId) {
						return {
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
							sourcePath: panel.sourcePath,
							worktreePath: panel.worktreePath,
						};
					}

					return panel;
				});
			});

			mockSessionStore.setSessions = mock((sessions) => {
				storedSessions = sessions;
			});

			mockSessionStore.loadSessions = mock(() => {
				mockSessionStore.setSessions(storedSessions);
				return okAsync(storedSessions);
			});

			mockSessionStore.getSessionCold = mock((sessionId: string) => {
				return storedSessions.find((session) => session.id === sessionId);
			});

			await manager.initialize();

			expect(mockSessionStore.loadSessions).toHaveBeenCalledWith([
				"/Users/alex/Documents/acepe",
			]);
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/Users/alex/Documents/acepe",
				"claude-code",
				undefined,
				"/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean",
				"Feature thread"
			);
			expect(mockSessionStore.connectSession).toHaveBeenCalledWith("session-1");
		});

		it("should handle initialization errors", async () => {
			mockAgentStore.loadAvailableAgents = mock(() =>
				errAsync(new AgentError("loadAgents", new Error("Failed")))
			) as AgentStore["loadAvailableAgents"];

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
