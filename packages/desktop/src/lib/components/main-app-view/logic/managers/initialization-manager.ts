/**
 * Initialization Manager - Manages app initialization.
 *
 * Handles the complex initialization flow including keybindings, workspace restoration,
 * session loading, and session connection.
 *
 * ## Initialization Flow (Optimized for Speed)
 *
 * ```
 * Phase 1 (Parallel):
 *   ├── initializeKeybindings()
 *   ├── initializeSessionUpdates()
 *   └── loadBasicMetadata() [keybindings, agents, projects, preconnection skills in parallel]
 *
 * Phase 2 (Sequential - needs projects):
 *   └── restoreWorkspace()
 *
 * Phase 3 (Sequential - restored sessions):
 *   ├── loadStartupSessions() [load only restored session metadata by id]
 *   ├── validateRestoredSessions() [clear orphaned restored session ids]
 *   ├── earlyPreloadPanelSessions() [preload restored panels after validation]
 *   └── triggerBackgroundScan() [refresh sidebar sessions without blocking panel hydration]
 *
 * Phase 3 fallback (Sequential - no restored sessions):
 *   └── loadSessionHistory() [full blocking sidebar load]
 *
 * Phase 4 (Fire & Forget):
 *   └── createSessionsForAgentOnlyPanels()
 * ```
 *
 * ## Session Loading Strategy
 *
 * Restored panels only open after session history is loaded and validated, so
 * startup never attempts to resume created session ids that have no persisted
 * history on disk.
 *
 * earlyPreloadPanelSessions clears panel session references on load failure and
 * reconnects restored sessions after backend-owned session open. validateRestoredSessions
 * handles remaining edge cases.
 */

import {
	errAsync,
	ResultAsync as NeverthrowResultAsync,
	okAsync,
	type ResultAsync,
} from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { getChangelogEntriesSince } from "$lib/changelog/index.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";
import { getZoomService } from "$lib/services/zoom.svelte.js";
import type { PreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import type { MainAppViewState } from "../main-app-view-state.svelte.js";
import { openPersistedSession } from "../open-persisted-session.js";

const logger = createLogger({ id: "initialization-manager", name: "InitializationManager" });
const HAS_SEEN_SPLASH_KEY: UserSettingKey = "has_seen_splash";
const LAST_SEEN_VERSION_KEY: UserSettingKey = "last_seen_version";
const SESSION_OPEN_TIMEOUT_MS = 30_000;

import { InitializationError, type MainAppViewError } from "../../errors/main-app-view-error.js";

type TauriWindow = Window & {
	__TAURI_INTERNALS__?: {
		invoke?: (...args: never[]) => Promise<never>;
	};
};

type ProjectManagerLike = Pick<ProjectManager, "loadProjects" | "projectCount" | "projects"> & {
	triggerProjectIconBackfill?: () => void;
};

/**
 * Handles app initialization.
 */
export class InitializationManager {
	private splashResolutionPromise: Promise<void> | null = null;

	/**
	 * Creates a new initialization manager.
	 *
	 * @param state - The main app view state
	 * @param sessionStore - The session store
	 * @param agentStore - The agent store
	 * @param panelStore - The panel store
	 * @param workspaceStore - The workspace store
	 * @param projectManager - The project manager
	 * @param agentPreferencesStore - The agent preferences store
	 * @param keybindingsService - The keybindings service
	 * @param preconnectionAgentSkillsStore - Startup-loaded agent skills for pre-connect slash commands
	 */
	constructor(
		private readonly state: MainAppViewState,
		private readonly sessionStore: SessionStore,
		private readonly agentStore: AgentStore,
		private readonly panelStore: PanelStore,
		private readonly workspaceStore: WorkspaceStore,
		private readonly projectManager: ProjectManagerLike,
		private readonly agentPreferencesStore: AgentPreferencesStore,
		private readonly keybindingsService: KeybindingsService,
		private readonly preconnectionAgentSkillsStore: PreconnectionAgentSkillsStore,
		private readonly sessionOpenHydrator: Pick<
			SessionOpenHydrator,
			"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
		>,
		private readonly openPersistedSessionFn: typeof openPersistedSession = openPersistedSession
	) {}

	/**
	 * Initializes the app.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	initialize(): ResultAsync<void, MainAppViewError> {
		// HMR guard - prevent concurrent or duplicate initializations
		if (this.state.initializationInProgress) {
			return okAsync(undefined);
		}
		if (this.state.initializationComplete) {
			return okAsync(undefined);
		}

		this.state.initializationInProgress = true;

		// Phase 0.5: Check if splash screen should be shown (async but fast)
		// This runs BEFORE anything else so splash shows immediately if needed
		void this.resolveSplashScreen();

		// Phase 0.6: Check if changelog should be shown (async but fast)
		this.checkChangelog();

		// Phase 1: Initialize core systems in parallel
		// - Keybindings (synchronous but wrapped)
		// - Session update subscription (sets up event listener)
		// - Basic metadata (agents, projects, user keybindings - already parallel internally)
		return (
			NeverthrowResultAsync.combine([
				this.initializeKeybindings(),
				this.initializeSessionUpdates(),
				this.loadBasicMetadata(),
			])
				.map(() => undefined)
				.andThen(() => this.initializeAgentPreferences())
				// Phase 2: Restore workspace (needs projects from Phase 1)
				.andThen(() => this.restoreWorkspace())
				.andThen((restoredSessionIds) => this.hydrateStartupPanels(restoredSessionIds))
				// Phase 4: Create sessions for panels with agent but no session (fire and forget)
				.andThen(() => this.createSessionsForAgentOnlyPanels())
				.map(() => {
					this.state.initializationComplete = true;
					this.state.initializationInProgress = false;
					return undefined;
				})
				.mapErr((error) => {
					this.state.initializationInProgress = false;
					return error;
				})
		);
	}

	/**
	 * Resolves splash screen visibility before startup gating decisions.
	 */
	resolveSplashScreen(): Promise<void> {
		if (this.splashResolutionPromise) {
			return this.splashResolutionPromise;
		}

		if (!this.hasTauriInvoke()) {
			this.state.showSplash = false;
			this.splashResolutionPromise = Promise.resolve();
			return this.splashResolutionPromise;
		}

		this.splashResolutionPromise = settings
			.getRaw(HAS_SEEN_SPLASH_KEY)
			.match(
				(value) => value,
				(error) => Promise.reject(error)
			)
			.then((value) => {
				// Show splash if value is not "true"
				this.state.showSplash = value !== "true";
			})
			.catch((error) => {
				logger.warn("Failed to check splash screen setting", { error });
				// On error, show splash to be safe
				this.state.showSplash = true;
			});

		return this.splashResolutionPromise;
	}

	/**
	 * Checks if changelog should be shown based on version comparison.
	 * Shows changelog if:
	 * 1. User has seen splash (not first launch)
	 * 2. Version has changed since last seen
	 * 3. Changelog exists for current version
	 *
	 * This is fire-and-forget to not block initialization.
	 */
	private checkChangelog(): void {
		// Fire-and-forget: errors are logged but don't block initialization
		this.performChangelogCheck().catch(
			(error: Error | string | number | boolean | null | undefined) => {
				logger.warn("Failed to check changelog", {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		);
	}

	/**
	 * Performs the actual changelog check logic.
	 * Separated for cleaner error handling in the fire-and-forget wrapper.
	 */
	private async performChangelogCheck(): Promise<void> {
		if (!this.hasTauriInvoke()) {
			return;
		}

		const { getVersion } = await import("@tauri-apps/api/app");
		const currentVersion = await getVersion();
		const lastSeenVersion = await settings.getRaw(LAST_SEEN_VERSION_KEY).match(
			(value) => value,
			() => null
		);

		// Show changelog entries between last seen and current version
		if (lastSeenVersion && lastSeenVersion !== currentVersion) {
			const entries = getChangelogEntriesSince(lastSeenVersion, currentVersion);
			if (entries.length > 0) {
				this.state.changelogEntries = entries;
				logger.debug("Showing changelog for version upgrade", {
					from: lastSeenVersion,
					to: currentVersion,
					entriesCount: entries.length,
				});
			}
		}

		// Always update last seen version (even on first launch)
		await settings.setRaw(LAST_SEEN_VERSION_KEY, currentVersion).match(
			() => undefined,
			() => undefined
		);
	}

	/**
	 * Initializes keybindings system.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private initializeKeybindings(): ResultAsync<void, MainAppViewError> {
		const initResult = this.keybindingsService.initialize();
		if (initResult.isErr()) {
			return errAsync(
				new InitializationError(
					"keybindings",
					initResult.error instanceof Error ? initResult.error : new Error(String(initResult.error))
				)
			);
		}

		this.keybindingsService.install(window);

		return okAsync(undefined);
	}

	/**
	 * Initializes session update routing.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private initializeSessionUpdates(): ResultAsync<void, MainAppViewError> {
		return this.sessionStore
			.initializeSessionUpdates()
			.mapErr(
				(error: AppError) =>
					new InitializationError(
						"initializeSessionUpdates",
						error instanceof Error ? error : new Error(String(error))
					)
			);
	}

	/**
	 * Loads basic metadata in parallel.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private loadBasicMetadata(): ResultAsync<void, MainAppViewError> {
		const loadAgentsAndWarmPreconnectionCommands = this.agentStore
			.loadAvailableAgents()
			.mapErr(
				(error) =>
					new InitializationError("loadAvailableAgents", error instanceof Error ? error : undefined)
			)
			.andThen((agents) =>
				this.preconnectionAgentSkillsStore.initialize(agents).orElse((error) => {
					logger.warn("Failed to warm preconnection agent skills; continuing startup", {
						error,
					});
					return okAsync(undefined);
				})
			);

		return NeverthrowResultAsync.combine([
			this.keybindingsService
				.loadUserKeybindings()
				.map(() => {
					this.keybindingsService.reinstall();
					return undefined;
				})
				.mapErr(
					(error) =>
						new InitializationError(
							"loadUserKeybindings",
							error instanceof Error ? error : undefined
						)
				),
			loadAgentsAndWarmPreconnectionCommands,
			this.projectManager
				.loadProjects()
				.map(() => {
					this.projectManager.triggerProjectIconBackfill?.();
					return undefined;
				})
				.mapErr(
					(error) =>
						new InitializationError("loadProjects", error instanceof Error ? error : undefined)
				),
			getZoomService()
				.initialize()
				.mapErr(
					(error) =>
						new InitializationError("initializeZoom", error instanceof Error ? error : undefined)
				),
		]).map(() => undefined);
	}

	/**
	 * Initializes agent preference state (onboarding + selected agents).
	 */
	private initializeAgentPreferences(): ResultAsync<void, MainAppViewError> {
		return this.agentPreferencesStore
			.initialize(this.agentStore.agents, this.projectManager.projectCount)
			.mapErr(
				(error) =>
					new InitializationError(
						"initializeAgentPreferences",
						error instanceof Error ? error : new Error(String(error))
					)
			);
	}

	/**
	 * Restores workspace state.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private restoreWorkspace(): ResultAsync<string[], MainAppViewError> {
		return this.workspaceStore
			.load()
			.map((workspace) => {
				// Always restore — panels gracefully handle missing projects/sessions.
				// This allows onboarding to import projects without clearing workspace.
				return this.workspaceStore.restore(
					workspace ?? {
						version: 6,
						panels: [],
						filePanels: [],
						activeFilePanelIdByOwnerPanelId: {},
						focusedPanelIndex: null,
						panelContainerScrollX: 0,
						savedAt: new Date().toISOString(),
					}
				);
			})
			.mapErr(
				(error) =>
					new InitializationError(
						"restoreWorkspace",
						error instanceof Error ? error : new Error(String(error))
					)
			);
	}

	/**
	 * Prioritize restored panel hydration on startup.
	 *
	 * When panels were open on the previous run, load only those session records first,
	 * validate them, hydrate panel content, and refresh the broader sidebar session list in
	 * the background. If no panels were restored, keep the existing full blocking history load.
	 */
	private hydrateStartupPanels(restoredSessionIds: string[]): ResultAsync<void, MainAppViewError> {
		if (restoredSessionIds.length === 0) {
			return this.loadSessionHistory(this.getKnownProjectPaths());
		}

		return this.sessionStore
			.loadStartupSessions(restoredSessionIds)
			.map((result) => result.aliasRemaps)
			.mapErr(
				(error) =>
					new InitializationError(
						"loadStartupSessions",
						error instanceof Error ? error : new Error(String(error))
					)
			)
			.andThen((aliasRemaps) => {
				this.remapAliasedPanelSessionIds(aliasRemaps);
				return this.validateRestoredSessions();
			})
			.map(() => {
				this.earlyPreloadPanelSessions();
				this.triggerBackgroundScan(this.getKnownProjectPaths());
				return undefined;
			});
	}

	/**
	 * Loads session history for sidebar.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private loadSessionHistory(projectPaths: string[]): ResultAsync<void, MainAppViewError> {
		return this.sessionStore
			.loadSessions(projectPaths)
			.map(() => undefined)
			.mapErr(
				(error) =>
					new InitializationError(
						"loadSessions",
						error instanceof Error ? error : new Error(String(error))
					)
			);
	}

	private getKnownProjectPaths(): string[] {
		const paths = new Set<string>();

		for (const project of this.projectManager.projects) {
			paths.add(project.path);
		}

		for (const panel of this.panelStore.panels) {
			if (panel.projectPath) {
				paths.add(panel.projectPath);
			}
		}

		return Array.from(paths);
	}

	/**
	 * Rewrites panel session IDs from alias (provider_session_id) to canonical
	 * (Acepe session ID) before validation runs, preventing panels from being
	 * cleared as orphaned when their stored ID was a provider alias.
	 */
	private remapAliasedPanelSessionIds(aliasRemaps: Record<string, string>): void {
		const remapEntries = Object.entries(aliasRemaps);
		if (remapEntries.length === 0) {
			return;
		}

		for (const panel of this.panelStore.panels) {
			if (panel.sessionId && panel.sessionId in aliasRemaps) {
				const canonicalId = aliasRemaps[panel.sessionId];
				logger.debug("Remapping panel session ID from alias to canonical", {
					panelId: panel.id,
					aliasId: panel.sessionId.substring(0, 8),
					canonicalId: canonicalId.substring(0, 8),
				});
				this.panelStore.updatePanelSession(panel.id, canonicalId);
			}
		}
	}

	/**
	 * Validates restored session IDs against loaded sessions.
	 * Clears sessionIds for panels where the session doesn't exist on disk.
	 *
	 * This handles the case where:
	 * 1. User creates a new session panel (eager session creation happens)
	 * 2. Never sends a message (no .jsonl file is written to disk)
	 * 3. App restarts
	 * 4. Panel has sessionId in persisted state, but session doesn't exist
	 *
	 * @returns ResultAsync indicating success
	 */
	private validateRestoredSessions(): ResultAsync<void, MainAppViewError> {
		let clearedCount = 0;
		for (const panel of this.panelStore.panels) {
			if (panel.sessionId && !this.sessionStore.getSessionCold(panel.sessionId)) {
				if (this.canRecoverRegistryOnlyPanel(panel)) {
					continue;
				}

				logger.debug("Session not found on disk, clearing from panel", {
					sessionId: panel.sessionId.substring(0, 8),
					panelId: panel.id,
				});
				this.panelStore.updatePanelSession(panel.id, null);
				clearedCount++;
			}
		}
		if (clearedCount > 0) {
			logger.info(`Cleared ${clearedCount} orphaned session reference(s) from panels`);
		}
		return okAsync(undefined);
	}

	private canRecoverRegistryOnlyPanel(panel: {
		sessionId: string | null;
		projectPath: string | null;
		agentId: string | null;
		selectedAgentId: string | null;
		sourcePath?: string | null;
	}): boolean {
		const projectPath = panel.projectPath;
		if (!panel.sessionId || !projectPath) {
			return false;
		}

		return !panel.sourcePath;
	}

	/**
	 * Trigger background scan for all projects in workspace.
	 * This ensures session list is fresh on startup.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private triggerBackgroundScan(projectPaths: string[]): void {
		if (projectPaths.length === 0) {
			return;
		}

		// Start scan in background - don't block initialization
		this.sessionStore.scanSessions(projectPaths).mapErr((error) => {
			console.warn("Background session scan failed:", error);
		});
	}

	/**
	 * Creates sessions for panels that have an agent selected but no session.
	 * This ensures models/modes are loaded for restored panels with a selected agent.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private createSessionsForAgentOnlyPanels(): ResultAsync<void, MainAppViewError> {
		const projects = this.projectManager.projects;

		// Only auto-create sessions if there's exactly one project
		// (for multiple projects, user must select which project to use)
		if (projects.length !== 1) {
			return okAsync(undefined);
		}

		const project = projects[0];

		// Find panels with selectedAgentId but no session.
		// Skip OpenCode at startup to avoid implicit agent startup side effects
		// (notably macOS TCC prompt bursts) before explicit user action.
		const panelsNeedingSessions = this.panelStore.panels.filter(
			(p) => p.selectedAgentId && !p.sessionId && p.selectedAgentId !== "opencode"
		);

		// Create sessions for each panel (in background, don't block)
		for (const panel of panelsNeedingSessions) {
			this.sessionStore
				.createSession({
					agentId: panel.selectedAgentId!,
					projectPath: project.path,
				})
				.map((session) => {
					this.panelStore.updatePanelSession(panel.id, session.id);
				})
				.mapErr(() => {
					// Error state will be shown via status indicator
				});
		}

		return okAsync(undefined);
	}

	/**
	 * Pre-loads restored panel session content in parallel with the sidebar scan,
	 * then reconnects the restored session so startup behavior matches manual open.
	 *
	 * Prefer canonical session metadata loaded from the backend; persisted panel fields
	 * are only fallback hints for sessions that have not been hydrated yet.
	 */
	private earlyPreloadPanelSessions(): void {
		for (const panel of this.panelStore.panels) {
			if (!panel.sessionId) continue;
			const session = this.sessionStore.getSessionCold(panel.sessionId);
			if (!session) continue;

			this.openPersistedSessionFn({
				panelId: panel.id,
				sessionId: panel.sessionId,
				sessionStore: this.sessionStore,
				sessionOpenHydrator: this.sessionOpenHydrator,
				timeoutMs: SESSION_OPEN_TIMEOUT_MS,
				source: "initialization-manager",
			});
		}
	}

	/**
	 * Cleans up initialization resources.
	 */
	cleanup(): void {
		this.keybindingsService.uninstall();
		this.state.initializationInProgress = false;
		this.state.initializationComplete = false;
		this.splashResolutionPromise = null;
	}

	private hasTauriInvoke(): boolean {
		const tauriWindow = window as TauriWindow;
		return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function";
	}
}
