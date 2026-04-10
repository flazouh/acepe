import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import type { SessionCold } from "$lib/acp/application/dto/session-cold.js";
import { AgentError } from "$lib/acp/errors/app-error.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionProjectionHydrator } from "$lib/acp/store/services/session-projection-hydrator.js";
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
	selectedAgentId: string | null;
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
	let mockProjectionHydrator: Pick<SessionProjectionHydrator, "hydrateSession" | "clearSession">;
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
			loadStartupSessions: mock(() => okAsync({ missing: [], aliasRemaps: {} })),
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

		mockProjectionHydrator = {
			hydrateSession: mock(() => okAsync(undefined)),
			clearSession: mock(() => {}),
		};

		manager = new InitializationManager(
			mockState,
			mockSessionStore,
			mockAgentStore,
			mockPanelStore,
			mockWorkspaceStore,
			mockProjectManager,
			mockAgentPreferencesStore,
			mockKeybindingsService,
			mockPreconnectionAgentSkillsStore,
			mockProjectionHydrator
		);
	});

	describe("resolveSplashScreen", () => {
		it("treats non-tauri environments as splash already resolved", async () => {
			await manager.resolveSplashScreen();

			expect(mockState.showSplash).toBe(false);
		});
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
				mockPreconnectionAgentSkillsStore,
				mockProjectionHydrator
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

		it("hydrates restored panels before running the background sidebar scan", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
				{ path: "/project2", name: "Project 2", createdAt: new Date(), color: "green" },
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
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
					sessionTitle: "Session 1",
				},
			];

			const restoredSession = buildSession("session-1", "claude-code", "/project1", "Session 1");
			const callOrder: string[] = [];

			mockSessionStore.loadStartupSessions = mock(() => {
				callOrder.push("startup");
				return okAsync({ missing: [], aliasRemaps: {} });
			}) as SessionStore["loadStartupSessions"];
			mockSessionStore.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1" ? restoredSession : undefined
			) as SessionStore["getSessionCold"];
			mockSessionStore.loadSessionById = mock(() => {
				callOrder.push("preload");
				return okAsync(restoredSession);
			}) as SessionStore["loadSessionById"];
			mockProjectionHydrator.clearSession = mock(() => {
				callOrder.push("clear");
			});
			mockSessionStore.scanSessions = mock((projectPaths: string[]) => {
				callOrder.push(`scan:${projectPaths.join(",")}`);
				return okAsync(undefined);
			}) as SessionStore["scanSessions"];

			await manager.initialize();

			expect(mockSessionStore.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(mockSessionStore.loadSessions).not.toHaveBeenCalled();
			expect(callOrder).toEqual(["startup", "preload", "scan:/project1,/project2", "clear"]);
		});

		it("clears orphaned restored session ids before attempting startup reconnect", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockWorkspaceStore.restore = mock(() => ["missing-session"]) as WorkspaceStore["restore"];
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
					sourcePath: "/project1/.claude/projects/missing-session.jsonl",
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

			expect(mockSessionStore.loadStartupSessions).toHaveBeenCalledWith(["missing-session"]);
			expect(mockSessionStore.loadSessions).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", null);
			expect(mockSessionStore.loadSessionById).not.toHaveBeenCalled();
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
		});

		it("preserves recoverable created-session restored ids", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockWorkspaceStore.restore = mock(() => ["recoverable-session"]) as WorkspaceStore["restore"];
			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "recoverable-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: null,
					sessionTitle: "Recover me",
					sourcePath: null,
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

			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
		});

		it("preserves recoverable created-session restored ids without frontend agent hints", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockWorkspaceStore.restore = mock(() => ["recoverable-session"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "recoverable-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: null,
					projectPath: "/project1",
					agentId: null,
					sessionTitle: "Recover me",
					sourcePath: null,
				},
			] as TestPanel[];

			await manager.initialize();

			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
		});

		it("preloads restored sessions using stored session metadata when panel metadata is missing", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
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

			expect(mockSessionStore.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(mockSessionStore.loadSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/project1",
				"cursor",
				undefined,
				undefined,
				"Recovered session"
			);
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
			expect(mockProjectionHydrator.clearSession).toHaveBeenCalledWith("session-1");
		});

		it("preloads restored sessions with persisted worktree context", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
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
			mockSessionStore.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/project1",
							agentId: "claude-code",
							title: "Feature thread",
							createdAt: new Date(),
							updatedAt: new Date(),
							parentId: null,
							worktreePath: "/project1/.git/worktrees/feature-a",
							sourcePath: "/project1/.cursor/sessions/session-1.json",
						}
					: undefined
			) as SessionStore["getSessionCold"];

			await manager.initialize();

			expect(mockSessionStore.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(mockSessionStore.loadSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/project1",
				"claude-code",
				"/project1/.cursor/sessions/session-1.json",
				"/project1/.git/worktrees/feature-a",
				"Feature thread"
			);
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
			expect(mockProjectionHydrator.clearSession).toHaveBeenCalledWith("session-1");
		});

		it("preloads restored sessions from canonical session metadata before stale panel cache", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "codex",
					projectPath: "/stale-project",
					agentId: "codex",
					sessionTitle: "Stale cached title",
					sourcePath: "/stale/session.json",
					worktreePath: "/stale/.git/worktrees/feature-a",
				},
			];
			mockSessionStore.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/project1",
							agentId: "claude-code",
							title: "Canonical title",
							createdAt: new Date(),
							updatedAt: new Date(),
							parentId: null,
							sourcePath: "/project1/.claude/session-1.jsonl",
							worktreePath: "/project1/.git/worktrees/feature-b",
						}
					: undefined
			) as SessionStore["getSessionCold"];

			await manager.initialize();

			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/project1",
				"claude-code",
				"/project1/.claude/session-1.jsonl",
				"/project1/.git/worktrees/feature-b",
				"Canonical title"
			);
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
			expect(mockProjectionHydrator.clearSession).toHaveBeenCalledWith("session-1");
		});

		it("does not clear a restored worktree session when history contains it", async () => {
			mockProjectManager.projects = [
				{
					path: "/Users/example/Documents/acepe",
					name: "acepe",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];

			let storedSessions: SessionCold[] = [
				buildSession(
					"session-1",
					"claude-code",
					"/Users/example/Documents/acepe",
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
				worktreePath: "/Users/example/.acepe/worktrees/worktree-123456/feature-branch",
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
					projectPath: "/Users/example/Documents/acepe",
					agentId: "claude-code",
					sessionTitle: "Feature thread",
					worktreePath: "/Users/example/.acepe/worktrees/worktree-123456/feature-branch",
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

			expect(mockSessionStore.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(mockSessionStore.loadSessions).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"session-1",
				"/Users/example/Documents/acepe",
				"claude-code",
				undefined,
				"/Users/example/.acepe/worktrees/worktree-123456/feature-branch",
				"Feature thread"
			);
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
			expect(mockProjectionHydrator.clearSession).toHaveBeenCalledWith("session-1");
		});

		it("remaps aliased panel session ids before validation", async () => {
			mockProjectManager.projects = [
				{ path: "/project1", name: "Project 1", createdAt: new Date(), color: "blue" },
			];
			// Panel was persisted with a provider alias ID
			mockWorkspaceStore.restore = mock(() => ["claude-session"]) as WorkspaceStore["restore"];
			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "claude-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "opencode",
					projectPath: "/project1",
					agentId: "opencode",
					sessionTitle: "Aliased Session",
					sourcePath: "/opencode/storage/session/acepe-uuid.json",
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

			// Backend returns the session under its canonical ID with an alias remap
			const canonicalSession = buildSession(
				"acepe-uuid",
				"opencode",
				"/project1",
				"Aliased Session"
			);
			mockSessionStore.loadStartupSessions = mock(() => {
				return okAsync({
					missing: [],
					aliasRemaps: { "claude-session": "acepe-uuid" },
				});
			}) as SessionStore["loadStartupSessions"];
			mockSessionStore.getSessionCold = mock((sessionId: string) =>
				sessionId === "acepe-uuid" ? canonicalSession : undefined
			) as SessionStore["getSessionCold"];
			mockSessionStore.loadSessionById = mock(() =>
				okAsync(canonicalSession)
			) as SessionStore["loadSessionById"];
			await manager.initialize();

			// Panel should be remapped from alias to canonical ID
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", "acepe-uuid");
			// Panel should NOT be cleared as orphaned
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
			// Session should be preloaded using the canonical ID
			expect(mockSessionStore.loadSessionById).toHaveBeenCalledWith(
				"acepe-uuid",
				"/project1",
				"opencode",
				"/opencode/storage/session/acepe-uuid.json",
				undefined,
				"Aliased Session"
			);
			expect(mockSessionStore.connectSession).not.toHaveBeenCalled();
			expect(mockProjectionHydrator.clearSession).toHaveBeenCalledWith("acepe-uuid");
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
				mockPreconnectionAgentSkillsStore,
				mockProjectionHydrator
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
