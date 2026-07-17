/**
 * Main App View State - Manages all state and operations for the main app view.
 *
 * This class follows the Svelte 5 runes class state pattern:
 * - Uses $state for reactive state
 * - Uses $derived for computed values
 * - Delegates business logic to specialized managers
 *
 * @example
 * ```ts
 * const state = new MainAppViewState(store, projectManager, kb, selectorRegistry);
 * await state.initialize();
 * state.handleSelectSession("session-1");
 * ```
 */

import { okAsync, type ResultAsync } from "neverthrow";
import type { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";
import { resolveDefaultAgentIdForCreate } from "$lib/acp/components/session-list/session-list-logic.js";
import type { SessionListItem } from "$lib/acp/components/session-list/session-list-types.js";
import type { WorktreeProjectDefaultStore } from "$lib/acp/components/worktree/worktree-project-default-store.svelte.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { SelectorRegistry } from "$lib/acp/logic/selector-registry.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type {
	Panel,
	PersistedReviewFullscreenState,
	ViewMode,
} from "$lib/acp/store/types.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { type IssueReportDraft, openIssueReportDraft } from "$lib/errors/issue-report.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { MainAppViewError } from "../errors/main-app-view-error.js";
import type { CreateSessionOptions } from "../types/create-session-options.js";
import {
	InitializationManager,
	type StartupPerformanceTraceEntry,
} from "./managers/initialization-manager.js";
import { KeybindingManager } from "./managers/keybinding-manager.js";
import { PanelHandler } from "./managers/panel-handler.js";
import { ProjectHandler } from "./managers/project-handler.js";
import { SessionHandler } from "./managers/session-handler.js";
import { ensureSpawnableAgentSelected } from "./spawnable-agents.js";

const logger = createLogger({ id: "main-app-view-state", name: "MainAppViewState" });

/**
 * Main app view state class.
 */
export class MainAppViewState {
	// ============================================
	// REACTIVE STATE ($state for Svelte reactivity)
	// ============================================

	/**
	 * Whether the debug panel is open.
	 */
	debugPanelOpen = $state(false);

	/**
	 * Whether the settings modal is open.
	 */
	settingsModalOpen = $state(false);

	/**
	 * Whether the full-screen review overlay is open.
	 */
	reviewFullscreenOpen = $state(false);

	/**
	 * Session ID for the full-screen review overlay (when open).
	 */
	reviewFullscreenSessionId = $state<string | null>(null);

	/**
	 * Selected file index in the full-screen review overlay.
	 */
	reviewFullscreenFileIndex = $state(0);

	/**
	 * Whether the command palette is open.
	 */
	commandPaletteOpen = $state(false);

	/**
	 * Whether the design system page is open (DEV only).
	 */
	designSystemOpen = $state(false);

	/**
	 * Whether the skills manager is open.
	 */
	skillsManagerOpen = $state(false);

	/**
	 * Open a GitHub issue with a prefilled draft.
	 */
	openUserReportsWithDraft(draft: IssueReportDraft): void {
		openIssueReportDraft(draft);
	}

	/**
	 * Whether the sidebar is open.
	 */
	sidebarOpen = $state(true);

	/** View mode before entering fullscreen, so we can restore it on exit. */
	private preFullscreenViewMode: ViewMode | null = null;

	/**
	 * File tree expansion state for persistence.
	 * Maps projectPath to array of expanded folder paths.
	 */
	fileTreeExpansion = $state<Record<string, string[]>>({});

	/**
	 * Project file view modes for persistence.
	 * Maps projectPath to "sessions" or "files" (file system view).
	 */
	projectFileViewModes = $state<Record<string, "sessions" | "files">>({});

	/**
	 * Collapsed project paths in the sidebar.
	 */
	collapsedProjectPaths = $state<string[]>([]);

	/**
	 * Whether initialization is in progress (HMR guard).
	 */
	initializationInProgress = $state(false);

	/**
	 * Whether initialization is complete (HMR guard).
	 */
	initializationComplete = $state(false);

	/**
	 * Whether persisted workspace chrome is still being restored.
	 */
	workspaceRestorationPending = $state(false);

	/**
	 * Whether the app shell can be shown before all startup data is ready.
	 */
	shellReady = $state(false);

	/**
	 * Initialization error, if any occurred during startup.
	 */
	initializationError = $state<Error | null>(null);

	/**
	 * Whether the splash screen should be shown.
	 * Starts as null (unknown) until we check the database.
	 */
	showSplash = $state<boolean | null>(null);

	// ============================================
	// DERIVED STATE ($derived for computed values)
	// ============================================

	/**
	 * Whether the app is showing the single-session fullscreen layout.
	 */
	get isFullscreen(): boolean {
		return this.panelStore.viewMode === "single";
	}

	/**
	 * Gets the session store.
	 */
	getSessionStore(): SessionStore {
		return this.sessionStore;
	}

	/**
	 * Gets the panel store.
	 */
	getPanelStore(): PanelStore {
		return this.panelStore;
	}

	// ============================================
	// PRIVATE MANAGERS (composition)
	// ============================================

	/**
	 * Initialization manager.
	 */
	private readonly initializationManager: InitializationManager;

	/**
	 * Session handler.
	 */
	private readonly sessionHandler: SessionHandler;

	/**
	 * Panel handler.
	 */
	private readonly panelHandler: PanelHandler;

	/**
	 * Project handler.
	 */
	private readonly projectHandler: ProjectHandler;

	/**
	 * Keybinding manager.
	 */
	private readonly keybindingManager: KeybindingManager;

	/**
	 * Creates a new main app view state.
	 *
	 * @param sessionStore - The session store
	 * @param panelStore - The panel store
	 * @param agentStore - The agent store
	 * @param connectionStore - The connection store
	 * @param workspaceStore - The workspace store
	 * @param projectManager - The project manager
	 * @param agentPreferencesStore - The agent preferences store
	 * @param keybindingsService - The keybindings service
	 * @param selectorRegistry - The selector registry
	 * @param worktreeProjectDefaultStore - Per-project worktree default preferences (reactive)
	 */
	constructor(
		private readonly sessionStore: SessionStore,
		private readonly panelStore: PanelStore,
		private readonly agentStore: AgentStore,
		private readonly connectionStore: ConnectionStore,
		private readonly workspaceStore: WorkspaceStore,
		private readonly projectManager: ProjectManager,
		private readonly agentPreferencesStore: AgentPreferencesStore,
		private readonly keybindingsService: KeybindingsService,
		private readonly selectorRegistry: SelectorRegistry,
		private readonly worktreeProjectDefaultStore: WorktreeProjectDefaultStore,
		private readonly sessionOpenHydrator: Pick<
			SessionOpenHydrator,
			"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
		>
	) {
		// Initialize managers
		this.initializationManager = new InitializationManager(
			this,
			this.sessionStore,
			this.agentStore,
			this.panelStore,
			this.workspaceStore,
			this.projectManager,
			this.agentPreferencesStore,
			this.keybindingsService,
			this.sessionOpenHydrator
		);
		this.sessionHandler = new SessionHandler(
			this,
			this.sessionStore,
			this.panelStore,
			this.sessionOpenHydrator
		);
		this.panelHandler = new PanelHandler(
			this,
			this.panelStore,
			this.sessionStore,
			this.connectionStore
		);
		this.projectHandler = new ProjectHandler(this, this.projectManager);
		this.keybindingManager = new KeybindingManager(
			this,
			this.keybindingsService,
			this.selectorRegistry,
			this.panelStore
		);

		// Register keybindings
		this.keybindingManager.registerKeybindings();

		// Set thread create handler
		this.keybindingManager.setThreadCreateHandler(() => {
			this.handleNewThread();
		});

		// Register workspace state providers for persistence
		this.workspaceStore.registerProviders({
			getSidebarOpen: () => this.sidebarOpen,
			setSidebarOpen: (open) => {
				this.sidebarOpen = open;
			},
			getFileTreeExpansion: () => this.fileTreeExpansion,
			setFileTreeExpansion: (expansion) => {
				this.fileTreeExpansion = expansion;
			},
			getProjectFileViewModes: () => this.projectFileViewModes,
			setProjectFileViewModes: (modes) => {
				this.projectFileViewModes = modes;
			},
			getCollapsedProjectPaths: () => this.collapsedProjectPaths,
			setCollapsedProjectPaths: (paths) => {
				this.collapsedProjectPaths = paths;
			},
			getReviewFullscreenState: () => ({
				open: this.reviewFullscreenOpen,
				sessionId: this.reviewFullscreenSessionId,
				fileIndex: this.reviewFullscreenFileIndex,
			}),
			setReviewFullscreenState: (state: PersistedReviewFullscreenState) => {
				if (state.open && state.sessionId) {
					this.reviewFullscreenOpen = true;
					this.reviewFullscreenSessionId = state.sessionId;
					this.reviewFullscreenFileIndex = state.fileIndex ?? 0;
				}
			},
		});
	}

	/**
	 * Handles file tree expansion state change.
	 * Called by SessionList when folders are expanded/collapsed.
	 */
	handleFileTreeExpansionChange(expansion: Record<string, string[]>): void {
		this.fileTreeExpansion = expansion;
		this.workspaceStore.persist();
	}

	/**
	 * Handles project file view mode change.
	 * Called by SessionList when user toggles between sessions and files view.
	 */
	handleProjectFileViewModeChange(modes: Record<string, "sessions" | "files">): void {
		this.projectFileViewModes = modes;
		this.workspaceStore.persist();
	}

	handleCollapsedProjectPathsChange(paths: string[]): void {
		this.collapsedProjectPaths = paths;
		this.workspaceStore.persist(true);
	}

	// ============================================
	// PUBLIC API - INITIALIZATION
	// ============================================

	/**
	 * Initializes the app.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	initialize(): ResultAsync<void, MainAppViewError> {
		return this.initializationManager.initialize();
	}

	resolveSplashScreen(): Promise<void> {
		return this.initializationManager.resolveSplashScreen();
	}

	getStartupPerformanceTrace(): StartupPerformanceTraceEntry[] {
		return this.initializationManager.getStartupPerformanceTrace();
	}

	/**
	 * Cleans up resources.
	 */
	cleanup(): void {
		this.initializationManager.cleanup();
	}

	// ============================================
	// PUBLIC API - SESSION OPERATIONS
	// ============================================

	/**
	 * Handles selecting a session.
	 *
	 * @param sessionId - The session ID to select
	 * @param sessionInfo - Optional session info for loading historical sessions
	 * @returns ResultAsync indicating success or error
	 */
	handleSelectSession(
		sessionId: string,
		sessionInfo?: SessionListItem
	): ResultAsync<void, MainAppViewError> {
		return this.sessionHandler.selectSession(sessionId, sessionInfo);
	}

	/**
	 * Handles creating a new session.
	 *
	 * @param options - Session creation options
	 * @returns ResultAsync containing the session ID or error
	 */
	handleCreateSession(options: CreateSessionOptions): ResultAsync<string, MainAppViewError> {
		return this.sessionHandler.createSession(options);
	}

	/**
	 * Handles creating a session for a specific project in a specific panel.
	 *
	 * @param panelId - The panel ID
	 * @param project - The project to create session for
	 * @returns ResultAsync indicating success or error
	 */
	handleCreateSessionForProject(
		panelId: string,
		project: Pick<Project, "path" | "name">
	): ResultAsync<void, MainAppViewError> {
		return this.sessionHandler.createSessionForProject(panelId, project);
	}

	/**
	 * Handles creating a new thread.
	 * - 0 projects: no-op
	 * - 1 project: spawn panel with agent selection for that project
	 * - 2+ projects in focused view: spawn panel with agent selection for the focused project
	 * - 2+ projects (normal view): show project selection
	 */
	/**
	 * Optional override for global new-thread entry points (⌘N, sidebar New chat).
	 * Project-scoped "+" actions always spawn a panel via handleNewThreadForProject.
	 */
	onNewThreadOverride:
		| ((request?: {
				readonly projectPath?: string;
				readonly agentId?: string;
				readonly modeId?: CanonicalModeId;
		  }) => void)
		| null = null;

	handleNewThread(): void {
		// Defensive guard: don't allow new thread if projectCount is unknown or 0
		if (this.projectManager.projectCount === null || this.projectManager.projectCount === 0) {
			return;
		}

		// Global new-thread (⌘N / New chat) can open the app-wide dialog.
		if (this.onNewThreadOverride) {
			this.onNewThreadOverride();
			return;
		}

		if (this.projectManager.projectCount === 1) {
			const project = this.projectManager.projects[0];
			this.handleNewThreadForProject(project.path);
			return;
		}

		// Use focused panel's project when available (covers both focused view and normal multi-project mode).
		const focusedProjectPath =
			this.panelStore.focusedViewProjectPath || this.panelStore.focusedTopLevelPanel?.projectPath;
		if (focusedProjectPath) {
			const project = this.projectManager.getProject(focusedProjectPath);
			if (project) {
				this.handleNewThreadForProject(project.path);
				return;
			}
		}

		// No focused project context - show project selection
		this.panelStore.spawnPanel({
			requireProjectSelection: true,
			pendingWorktreeEnabled: this.worktreeProjectDefaultStore.isEnabled(
				this.panelStore.focusedViewProjectPath
			),
		});
	}

	/**
	 * Spawns a new agent panel for a specific project (sidebar/tab "+" controls).
	 * Always creates a panel; does not open the global new-chat dialog.
	 *
	 * @param projectPath - The project path to create a thread for
	 * @param agentId - Optional agent ID to preselect on the new panel
	 */
	handleNewThreadForProject(projectPath: string, agentId?: string): void {
		const project = this.projectManager.getProject(projectPath);
		if (!project) {
			return;
		}

		const resolvedAgentId =
			agentId ??
			resolveDefaultAgentIdForCreate(
				this.agentStore.agents,
				this.agentPreferencesStore.defaultAgentId
			);

		const panel = this.panelStore.spawnPanel({
			requireProjectSelection: false,
			projectPath: project.path,
			pendingWorktreeEnabled: this.worktreeProjectDefaultStore.isEnabled(project.path),
		});
		if (resolvedAgentId) {
			this.panelStore.setPanelAgent(panel.id, resolvedAgentId);
		}
	}

	// ============================================
	// PUBLIC API - PANEL OPERATIONS
	// ============================================

	/**
	 * Handles closing a panel.
	 *
	 * @param panelId - The panel ID to close
	 */
	handleClosePanel(panelId: string): void {
		this.panelHandler.closePanel(panelId);
	}

	/**
	 * Handles resizing a panel.
	 *
	 * @param panelId - The panel ID to resize
	 * @param delta - The resize delta in pixels
	 */
	handleResizePanel(panelId: string, delta: number): void {
		this.panelHandler.resizePanel(panelId, delta);
	}

	/**
	 * Handles toggling fullscreen for a panel.
	 * Entering fullscreen switches to single view with an explicit fullscreen panel.
	 * Exiting fullscreen always restores to the previous non-single view (project/multi).
	 * The tab bar stays visible throughout; it is not hidden on enter.
	 *
	 * @param panelId - The panel to enter fullscreen with (ignored when exiting)
	 */
	handleToggleFullscreen(panelId: string): void {
		if (!this.panelStore.getTopLevelPanel(panelId)) {
			this.panelStore.toggleFullscreen(panelId);
			return;
		}

		if (this.panelStore.viewMode === "single" && this.panelStore.focusedPanelId === panelId) {
			// Exiting fullscreen: restore to the previous non-single view mode.
			// Never restore to "single" — that still renders the fullscreen layout.
			const restoreMode =
				this.preFullscreenViewMode !== "single" && this.preFullscreenViewMode != null
					? this.preFullscreenViewMode
					: "project";
			this.panelStore.setViewMode(restoreMode);
			this.preFullscreenViewMode = null;
			this.setSidebarOpen(true);
		} else {
			// Entering fullscreen: save current view mode and switch to single.
			if (this.panelStore.viewMode !== "single") {
				this.preFullscreenViewMode = this.panelStore.viewMode;
			}
			this.panelStore.focusPanel(panelId);
			this.panelStore.setViewMode("single");
		}
	}

	/**
	 * Handles switching fullscreen to a different panel.
	 *
	 * @param panelId - The panel ID to switch fullscreen to
	 */
	handleSwitchFullscreenPanel(panelId: string): void {
		this.panelHandler.switchFullscreenPanel(panelId);
	}

	/**
	 * Handles focusing a panel.
	 *
	 * @param panelId - The panel ID to focus
	 */
	handleFocusPanel(panelId: string): void {
		this.panelHandler.focusPanel(panelId);
	}

	/**
	 * Handles spawning a new panel.
	 *
	 * @param options - Panel options
	 * @returns The created panel
	 */
	handleSpawnPanel(options: { requireProjectSelection: boolean }): Panel {
		return this.panelHandler.spawnPanel(options);
	}

	/**
	 * Handles session created event.
	 *
	 * @param sessionId - The session ID
	 */
	handleSessionCreated(sessionId: string): void {
		this.panelStore.openSession(sessionId, 450); // DEFAULT_PANEL_WIDTH
	}

	// ============================================
	// PUBLIC API - PROJECT OPERATIONS
	// ============================================

	/**
	 * Handles adding a new project.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	handleAddProject(): ResultAsync<void, MainAppViewError> {
		return this.projectHandler.addProject();
	}

	// ============================================
	// PUBLIC API - UI STATE OPERATIONS
	// ============================================

	/**
	 * Opens the settings overlay.
	 * Guards against opening when splash screen or forced update is showing.
	 */
	openSettings(): void {
		if (this.showSplash === true) return;
		this.settingsModalOpen = true;
	}

	/**
	 * Closes the settings overlay.
	 */
	closeSettings(): void {
		this.settingsModalOpen = false;
	}

	/**
	 * Toggles the settings overlay open/closed.
	 */
	toggleSettings(): void {
		if (this.settingsModalOpen) {
			this.closeSettings();
		} else {
			this.openSettings();
		}
	}

	/**
	 * Toggles the design system page open/closed (DEV only).
	 */
	toggleDesignSystem(): void {
		this.designSystemOpen = !this.designSystemOpen;
	}

	/**
	 * Opens the full-screen review overlay for a session.
	 */
	openReviewFullscreen(sessionId: string, fileIndex: number = 0): void {
		if (this.showSplash === true) return;
		this.reviewFullscreenOpen = true;
		this.reviewFullscreenSessionId = sessionId;
		this.reviewFullscreenFileIndex = fileIndex;
		this.workspaceStore.persist();
	}

	/**
	 * Closes the full-screen review overlay.
	 * Preserves sessionId and fileIndex so the component stays alive
	 * and hunk accept/reject decisions survive re-open.
	 */
	closeReviewFullscreen(): void {
		this.reviewFullscreenOpen = false;
		// Keep reviewFullscreenSessionId and reviewFullscreenFileIndex
		// so the overlay component survives in hidden state.
		this.workspaceStore.persist();
	}

	/**
	 * Fully clears review fullscreen state.
	 * Called when the session is no longer valid (e.g., deleted).
	 */
	clearReviewFullscreen(): void {
		this.reviewFullscreenOpen = false;
		this.reviewFullscreenSessionId = null;
		this.reviewFullscreenFileIndex = 0;
		this.workspaceStore.persist();
	}

	/**
	 * Updates the selected file index in the full-screen review overlay.
	 */
	setReviewFullscreenFileIndex(index: number): void {
		this.reviewFullscreenFileIndex = index;
		this.workspaceStore.persist();
	}

	/**
	 * Toggles the sidebar open/closed state and persists it.
	 */
	toggleSidebar(): void {
		this.sidebarOpen = !this.sidebarOpen;
		this.workspaceStore.persist();
	}

	/**
	 * Sets the sidebar open/closed state and persists it.
	 *
	 * @param open - Whether the sidebar should be open
	 */
	setSidebarOpen(open: boolean): void {
		this.sidebarOpen = open;
		this.workspaceStore.persist();
	}

	/**
	 * Dismisses the splash screen and marks it as seen.
	 * Called when user clicks Enter button or presses Cmd+Enter.
	 */
	dismissSplash(): void {
		this.showSplash = false;
	}

	// ============================================
	// PUBLIC API - AGENT OPERATIONS
	// ============================================

	/**
	 * Handles changing the agent for a specific panel.
	 * Creates a new session with the new agent to load its models/modes.
	 * Shows loading state while the session is being created.
	 *
	 * Updates the EXISTING panel with the new session (does not spawn a new panel).
	 *
	 * @param panelId - The panel ID
	 * @param agentId - The agent ID to set for this panel
	 */
	handlePanelAgentChange(panelId: string, agentId: string): void {
		// Update panel state only. Session creation is deferred until first send.
		this.panelStore.setPanelAgent(panelId, agentId);

		const agentIsSelected = this.agentPreferencesStore.selectedAgentIds.includes(agentId);
		if (agentIsSelected) {
			return;
		}

		const nextSelectedAgentIds = ensureSpawnableAgentSelected(
			this.agentPreferencesStore.selectedAgentIds,
			agentId
		);

		void this.agentPreferencesStore.setSelectedAgentIds(nextSelectedAgentIds).match(
			() => undefined,
			(error) => {
				logger.error("[SpawnableAgents] Failed to persist selected agents", {
					agentId,
					error,
					panelId,
				});
			}
		);
	}
}
