/**
 * Initialization Manager - Manages app initialization.
 *
 * Handles the complex initialization flow including keybindings, workspace restoration,
 * session loading, and session connection.
 *
 * ## Initialization Flow (Optimized for Speed)
 *
 * ```
 * Phase 1:
 *   └── initializeKeybindings()
 *
 * Phase 2 (shell ready):
 *   └── mark shell ready once keybindings are attached
 *
 * Phase 2.5 (app init complete):
 *   └── mark init complete once the keyboard shell is ready
 *
 * Phase 3 (workspace chrome):
 *   └── restoreWorkspace() [scheduled after app init resolves]
 *
 * Phase 4 (metadata after init):
 *   ├── loadProjectsAfterStartup() [refresh project chrome]
 *   ├── scanStartupSessionHistory() [deferred behind restored panel hydration]
 *   └── initializeZoomAfterStartup()
 *
 * Phase 5 (Sequential - restored sessions):
 *   └── scheduleRestoredPanelHydration() [load restored session metadata after first-interaction time]
 *
	 * Phase 6 (Fire & Forget):
 *   ├── initializeSessionUpdatesInBackground()
 *   ├── loadUserKeybindingsAfterStartup()
 *   ├── loadAvailableAgentsAfterStartup()
 *   ├── createSessionsForAgentOnlyPanels() [after agent metadata arrives]
 *   ├── persisted preference loads are scheduled after agent metadata arrives
 *   └── warmRecentTranscriptRowLedgersAfterStartup() [deferred behind restored panel preload]
 * ```
 *
 * ## Session Loading Strategy
 *
 * Restored panel shells come from workspace state immediately. Backend-owned
 * metadata validation runs before reconnect, but after the app shell is usable.
 * validateRestoredSessions handles missing/deleted session edge cases.
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { Agent } from "$lib/acp/store/types.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { getZoomService } from "$lib/services/zoom.svelte.js";
import { history } from "$lib/utils/tauri-client/history.js";
import { settings } from "$lib/utils/tauri-client/settings.js";
import type { MainAppViewState } from "../main-app-view-state.svelte.js";
import { openPersistedSession } from "../open-persisted-session.js";

const logger = createLogger({
	id: "initialization-manager",
	name: "InitializationManager",
});
const HAS_SEEN_SPLASH_KEY: UserSettingKey = "has_seen_splash";
const HAS_SEEN_SPLASH_HOT_CACHE_KEY = "acepe.has_seen_splash.hot_cache";
const SESSION_OPEN_TIMEOUT_MS = 30_000;
const POST_STARTUP_IDLE_WORK_DELAY_MS = 5_000;
const POST_STARTUP_IDLE_WORK_TIMEOUT_MS = 5_000;
const RESTORED_PANEL_PRELOAD_IDLE_WORK_DELAY_MS = 30_000;
const RESTORED_PANEL_PRELOAD_IDLE_WORK_TIMEOUT_MS = 10_000;
const PERSISTED_AGENT_PREFERENCES_IDLE_WORK_DELAY_MS = 30_000;
const PERSISTED_AGENT_PREFERENCES_IDLE_WORK_TIMEOUT_MS = 10_000;
const TRANSCRIPT_ROW_LEDGER_BACKFILL_LIMIT = 8;

import { InitializationError, type MainAppViewError } from "../../errors/main-app-view-error.js";

export type StartupPerformanceTraceStatus = "pending" | "ok" | "error";
export type PostStartupWorkScheduler = (callback: () => void) => void;

export interface StartupPerformanceTraceEntry {
	readonly name: string;
	readonly startedAtMs: number;
	readonly completedAtMs: number | null;
	readonly durationMs: number | null;
	readonly status: StartupPerformanceTraceStatus;
	readonly errorMessage: string | null;
}

interface MutableStartupPerformanceTraceEntry {
	name: string;
	startedAtMs: number;
	completedAtMs: number | null;
	durationMs: number | null;
	status: StartupPerformanceTraceStatus;
	errorMessage: string | null;
}

function scheduleTimeout(callback: () => void, delayMs: number): void {
	const timer =
		typeof window !== "undefined" && typeof window.setTimeout === "function"
			? window.setTimeout(callback, delayMs)
			: setTimeout(callback, delayMs);
	if (typeof timer === "object" && timer !== null && "unref" in timer) {
		const maybeUnref = (timer as { unref?: () => void }).unref;
		if (typeof maybeUnref === "function") {
			maybeUnref.call(timer);
		}
	}
}

function scheduleIdleWorkAfterDelay(
	callback: () => void,
	delayMs: number,
	timeoutMs: number
): void {
	if (typeof window !== "undefined") {
		scheduleTimeout(() => {
			const schedulingWindow = window as Window & {
				requestIdleCallback?: (
					callback: IdleRequestCallback,
					options?: IdleRequestOptions
				) => number;
			};
			if (typeof schedulingWindow.requestIdleCallback === "function") {
				schedulingWindow.requestIdleCallback(callback, {
					timeout: timeoutMs,
				});
				return;
			}
			scheduleTimeout(callback, 0);
		}, delayMs);
		return;
	}
	scheduleTimeout(callback, delayMs);
}

function schedulePostStartupIdleWork(callback: () => void): void {
	scheduleIdleWorkAfterDelay(
		callback,
		POST_STARTUP_IDLE_WORK_DELAY_MS,
		POST_STARTUP_IDLE_WORK_TIMEOUT_MS
	);
}

function scheduleRestoredPanelPreloadIdleWork(callback: () => void): void {
	scheduleIdleWorkAfterDelay(
		callback,
		RESTORED_PANEL_PRELOAD_IDLE_WORK_DELAY_MS,
		RESTORED_PANEL_PRELOAD_IDLE_WORK_TIMEOUT_MS
	);
}

function schedulePersistedAgentPreferencesIdleWork(callback: () => void): void {
	scheduleIdleWorkAfterDelay(
		callback,
		PERSISTED_AGENT_PREFERENCES_IDLE_WORK_DELAY_MS,
		PERSISTED_AGENT_PREFERENCES_IDLE_WORK_TIMEOUT_MS
	);
}

function scheduleImmediatePostStartupWork(callback: () => void): void {
	setTimeout(callback, 0);
}

type TauriWindow = Window & {
	__TAURI_INTERNALS__?: {
		invoke?: (...args: never[]) => Promise<never>;
	};
};

type ProjectManagerLike = Pick<
	ProjectManager,
	"loadProjects" | "projectCount" | "projects" | "projectStorageFresh"
> & {
	triggerProjectIconBackfill?: () => void;
};

function readSplashSeenHotCache(): boolean | null {
	if (typeof localStorage === "undefined") {
		return null;
	}
	const cached = localStorage.getItem(HAS_SEEN_SPLASH_HOT_CACHE_KEY);
	if (cached === "true") {
		return true;
	}
	if (cached === "false") {
		return false;
	}
	return null;
}

export function writeSplashSeenHotCache(seen: boolean): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	localStorage.setItem(HAS_SEEN_SPLASH_HOT_CACHE_KEY, seen ? "true" : "false");
}

/**
 * Handles app initialization.
 */
export class InitializationManager {
	private splashResolutionPromise: Promise<void> | null = null;
	private readonly startupTraceEntries: MutableStartupPerformanceTraceEntry[] = [];

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
		private readonly sessionOpenHydrator: Pick<
			SessionOpenHydrator,
			"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
		>,
		private readonly schedulePostStartupWork: PostStartupWorkScheduler = schedulePostStartupIdleWork,
		private readonly scheduleRestoredPanelPreloadWork: PostStartupWorkScheduler = scheduleRestoredPanelPreloadIdleWork,
		private readonly schedulePersistedAgentPreferencesWork: PostStartupWorkScheduler = schedulePersistedAgentPreferencesIdleWork
	) {}

	private beginStartupTrace(name: string): number {
		const index = this.startupTraceEntries.length;
		this.startupTraceEntries.push({
			name,
			startedAtMs: Math.round(performance.now() * 100) / 100,
			completedAtMs: null,
			durationMs: null,
			status: "pending",
			errorMessage: null,
		});
		return index;
	}

	private finishStartupTrace(
		index: number,
		status: Exclude<StartupPerformanceTraceStatus, "pending">,
		errorMessage: string | null
	): void {
		const entry = this.startupTraceEntries[index];
		if (entry === undefined) {
			return;
		}
		const completedAtMs = Math.round(performance.now() * 100) / 100;
		entry.completedAtMs = completedAtMs;
		entry.durationMs = Math.round((completedAtMs - entry.startedAtMs) * 100) / 100;
		entry.status = status;
		entry.errorMessage = errorMessage;
	}

	private finishStartupTraceIfPending(
		index: number,
		status: Exclude<StartupPerformanceTraceStatus, "pending">,
		errorMessage: string | null
	): void {
		const entry = this.startupTraceEntries[index];
		if (entry === undefined || entry.completedAtMs !== null) {
			return;
		}
		this.finishStartupTrace(index, status, errorMessage);
	}

	private describeStartupTraceError<E>(error: E): string {
		return String(error);
	}

	private traceStartupResult<T, E>(
		name: string,
		result: ResultAsync<T, E>
	): ResultAsync<T, E> {
		const index = this.beginStartupTrace(name);
		return result
			.map((value) => {
				this.finishStartupTrace(index, "ok", null);
				return value;
			})
			.mapErr((error) => {
				this.finishStartupTrace(index, "error", this.describeStartupTraceError(error));
				return error;
			});
	}

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
		this.state.shellReady = false;
		this.state.workspaceRestorationPending = true;
		const initializeTraceIndex = this.beginStartupTrace("initialize");
		const shellReadyTraceIndex = this.beginStartupTrace("shellReady");

		// Phase 0.5: Check if splash screen should be shown (async but fast)
		// This runs BEFORE anything else so splash shows immediately if needed
		void this.resolveSplashScreen();

		// Phase 1: Initialize the critical keyboard shell path.
		return (
			this.traceStartupResult("initializeKeybindings", this.initializeKeybindings())
				.map(() => {
					this.state.shellReady = true;
					this.finishStartupTraceIfPending(shellReadyTraceIndex, "ok", null);
					this.completeInitialization(initializeTraceIndex);
					scheduleImmediatePostStartupWork(() => {
						this.restoreWorkspaceAfterInitialization();
					});
					return undefined;
				})
				.mapErr((error) => {
					this.state.initializationInProgress = false;
					this.state.workspaceRestorationPending = false;
					this.finishStartupTraceIfPending(
						shellReadyTraceIndex,
						"error",
						this.describeStartupTraceError(error)
					);
					this.finishStartupTrace(
						initializeTraceIndex,
						"error",
						this.describeStartupTraceError(error)
					);
					return error;
				})
		);
	}

	private completeInitialization(initializeTraceIndex: number): void {
		this.state.initializationComplete = true;
		this.state.initializationInProgress = false;
		this.finishStartupTrace(initializeTraceIndex, "ok", null);
		this.schedulePostStartupWork(() => {
			this.initializeSessionUpdatesInBackground();
		});
		scheduleImmediatePostStartupWork(() => {
			this.loadUserKeybindingsAfterStartup();
		});
		this.schedulePostStartupWork(() => {
			this.loadAvailableAgentsAfterStartup();
		});
		this.scheduleRestoredPanelPreloadWork(() => {
			this.warmRecentTranscriptRowLedgersAfterStartup();
		});
	}

	private restoreWorkspaceAfterInitialization(): void {
		void this.traceStartupResult(
			"background:restoreWorkspace",
			this.restoreWorkspace()
				.map((restoredSessionIds) => {
					scheduleImmediatePostStartupWork(() => {
						this.loadBasicMetadataAfterStartup(restoredSessionIds);
					});
					return undefined;
				})
				.orElse((error) => {
					logger.warn("Failed to restore workspace after init", { error });
					this.state.initializationError = error;
					scheduleImmediatePostStartupWork(() => {
						this.loadBasicMetadataAfterStartup([]);
					});
					return okAsync(undefined);
				})
		).match(
			() => {
				this.state.workspaceRestorationPending = false;
			},
			() => {
				this.state.workspaceRestorationPending = false;
			}
		);
	}

	getStartupPerformanceTrace(): StartupPerformanceTraceEntry[] {
		return this.startupTraceEntries.map((entry) => ({
			name: entry.name,
			startedAtMs: entry.startedAtMs,
			completedAtMs: entry.completedAtMs,
			durationMs: entry.durationMs,
			status: entry.status,
			errorMessage: entry.errorMessage,
		}));
	}

	/**
	 * Resolves splash screen visibility before startup gating decisions.
	 */
	resolveSplashScreen(): Promise<void> {
		if (this.splashResolutionPromise) {
			return this.splashResolutionPromise;
		}

		const traceIndex = this.beginStartupTrace("resolveSplashScreen");

		if (!this.hasTauriInvoke()) {
			this.state.showSplash = false;
			this.finishStartupTrace(traceIndex, "ok", null);
			this.splashResolutionPromise = Promise.resolve();
			return this.splashResolutionPromise;
		}

		const cachedSeen = readSplashSeenHotCache();
		if (cachedSeen !== null) {
			this.state.showSplash = !cachedSeen;
			this.finishStartupTrace(traceIndex, "ok", null);
			this.splashResolutionPromise = Promise.resolve();
			this.schedulePostStartupWork(() => {
				void this.traceStartupResult(
					"background:reconcileSplashSeenHotCache",
					settings
						.getRaw(HAS_SEEN_SPLASH_KEY)
						.map((value) => {
							const persistedSeen = value === "true";
							writeSplashSeenHotCache(persistedSeen);
							if (this.state.showSplash !== !persistedSeen) {
								this.state.showSplash = !persistedSeen;
							}
							return undefined;
						})
						.orElse((error) => {
							logger.warn("Failed to reconcile splash screen hot cache", { error });
							return okAsync(undefined);
						})
				).match(
					() => undefined,
					() => undefined
				);
			});
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
				const seen = value === "true";
				this.state.showSplash = !seen;
				writeSplashSeenHotCache(seen);
				this.finishStartupTrace(traceIndex, "ok", null);
			})
			.catch((error: Error) => {
				logger.warn("Failed to check splash screen setting", { error });
				// On error, show splash to be safe
				this.state.showSplash = true;
				this.finishStartupTrace(traceIndex, "error", this.describeStartupTraceError(error));
			});

		return this.splashResolutionPromise;
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

	private initializeSessionUpdatesInBackground(): void {
		void this.traceStartupResult(
			"background:initializeSessionUpdates",
			this.initializeSessionUpdates()
		)
			.orElse((error) => {
				logger.warn("Failed to initialize session updates after startup", { error });
				this.state.initializationError = error;
				return okAsync(undefined);
			})
			.match(
				() => undefined,
				() => undefined
			);
	}

	private loadBasicMetadataAfterStartup(restoredSessionIds: string[]): void {
		if (restoredSessionIds.length > 0) {
			this.scheduleRestoredPanelHydration(restoredSessionIds);
		}

		void this.traceStartupResult(
			"background:loadProjects",
			this.loadProjectsAfterStartup()
				.map(() => {
					this.scheduleStartupSessionHistoryScan();
					return undefined;
				})
				.orElse((error) => {
					logger.warn("Failed to load project metadata after init", { error });
					return okAsync(undefined);
				})
		).match(
			() => undefined,
			() => undefined
		);

		void this.traceStartupResult(
			"background:initializeZoom",
			this.initializeZoomAfterStartup().orElse((error) => {
				logger.warn("Failed to initialize zoom after init", { error });
				return okAsync(undefined);
			})
		).match(
			() => undefined,
			() => undefined
		);
	}

	private scheduleStartupSessionHistoryScan(): void {
		this.schedulePostStartupWork(() => {
			void this.traceStartupResult(
				"background:scanStartupSessionHistory",
				this.scanStartupSessionHistory().orElse((error) => {
					logger.warn("Failed to scan startup session history after init", { error });
					return okAsync(undefined);
				})
			).match(
				() => undefined,
				() => undefined
			);
		});
	}

	private loadProjectsAfterStartup(): ResultAsync<void, MainAppViewError> {
		return this.traceStartupResult(
			"loadProjects",
			this.projectManager
				.loadProjects()
				.map(() => {
					this.schedulePostStartupWork(() => {
						this.projectManager.triggerProjectIconBackfill?.();
					});
					return undefined;
				})
				.mapErr(
					(error) =>
						new InitializationError(
							"loadProjects",
							error instanceof Error ? error : undefined
						)
				)
		);
	}

	private initializeZoomAfterStartup(): ResultAsync<void, MainAppViewError> {
		return this.traceStartupResult(
			"initializeZoom",
			getZoomService()
				.initialize()
				.mapErr(
					(error) =>
						new InitializationError(
							"initializeZoom",
							error instanceof Error ? error : undefined
						)
				)
		);
	}

	private scanStartupSessionHistory(): ResultAsync<void, MainAppViewError> {
		const projectPaths = this.getKnownProjectPaths();
		if (projectPaths.length === 0) {
			return okAsync(undefined);
		}

		return this.sessionStore.loading.scanSessions(projectPaths).mapErr(
			(error) =>
				new InitializationError(
					"scanStartupSessionHistory",
					error instanceof Error ? error : new Error(String(error))
				)
		);
	}

	private getKnownProjectPaths(): string[] {
		return this.projectManager.projects.map((project) => project.path);
	}

	private loadAvailableAgentsAfterStartup(): void {
		void this.traceStartupResult(
			"background:loadAvailableAgents",
			this.agentStore
				.loadAvailableAgents()
				.mapErr(
					(error) =>
						new InitializationError("loadAvailableAgents", error instanceof Error ? error : undefined)
				)
				.andThen((agents) => {
					this.primeAgentPreferences(agents);
					this.schedulePersistedAgentPreferencesWork(() => {
						this.initializeAgentPreferencesAfterStartup(agents);
					});
					return this.traceStartupResult(
						"background:createSessionsForAgentOnlyPanels",
						this.createSessionsForAgentOnlyPanels()
					);
				})
				.orElse((error) => {
					logger.warn("Failed to load available agents after startup", { error });
					return okAsync(undefined);
				})
		).match(
			() => undefined,
			() => undefined
		);
	}

	private warmRecentTranscriptRowLedgersAfterStartup(): void {
		if (this.hasOpenSessionPanel()) {
			logger.debug("Skipping transcript row ledger warmup while session panels are open");
			return;
		}

		void this.traceStartupResult(
			"background:warmRecentTranscriptRowLedgers",
			history
				.warmRecentTranscriptRowLedgers(TRANSCRIPT_ROW_LEDGER_BACKFILL_LIMIT)
				.map((result) => {
					logger.debug("Warmed recent transcript row ledgers after startup", {
						requestedLimit: result.requestedLimit,
						candidateCount: result.candidateCount,
						checkedCount: result.checkedCount,
						rebuiltCount: result.rebuiltCount,
						rebuiltFromProviderCount: result.rebuiltFromProviderCount,
						skippedCurrentCount: result.skippedCurrentCount,
						skippedNoJournalCount: result.skippedNoJournalCount,
						skippedMissingFactsCount: result.skippedMissingFactsCount,
						failedCount: result.failedCount,
					});
					return undefined;
				})
				.orElse((error) => {
					logger.warn("Failed to warm recent transcript row ledgers after startup", { error });
					return okAsync(undefined);
				})
		).match(
			() => undefined,
			() => undefined
		);
	}

	private hasOpenSessionPanel(): boolean {
		for (const panel of this.panelStore.panels) {
			if (panel.sessionId !== null) {
				return true;
			}
		}
		return false;
	}

	private loadUserKeybindings(): ResultAsync<void, MainAppViewError> {
		return this.keybindingsService
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
			);
	}

	private loadUserKeybindingsAfterStartup(): void {
		void this.traceStartupResult(
			"background:loadUserKeybindings",
			this.loadUserKeybindings().orElse((error) => {
				logger.warn("Failed to load user keybindings after startup", { error });
				return okAsync(undefined);
			})
		).match(
			() => undefined,
			() => undefined
		);
	}

	/**
	 * Initializes agent preference state (onboarding + selected agents).
	 */
	private initializeAgentPreferences(
		agents: readonly Agent[] = this.agentStore.agents
	): ResultAsync<void, MainAppViewError> {
		return this.agentPreferencesStore
			.initialize(agents, this.projectManager.projectCount)
			.mapErr(
				(error) =>
					new InitializationError(
						"initializeAgentPreferences",
						error instanceof Error ? error : new Error(String(error))
					)
			);
	}

	private primeAgentPreferences(agents: readonly Agent[] = this.agentStore.agents): void {
		this.agentPreferencesStore.primeStartupDefaults(
			agents,
			this.projectManager.projectCount
		);
	}

	private initializeAgentPreferencesAfterStartup(
		agents: readonly Agent[] = this.agentStore.agents
	): void {
		void this.traceStartupResult(
			"background:initializeAgentPreferences",
			this.initializeAgentPreferences(agents).orElse((error) => {
				logger.warn("Failed to load persisted agent preferences after startup", { error });
				return okAsync(undefined);
			})
		).match(
			() => undefined,
			() => undefined
		);
	}

	/**
	 * Restores workspace state.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private restoreWorkspace(): ResultAsync<string[], MainAppViewError> {
		const loadTraceIndex = this.beginStartupTrace("loadWorkspaceState");
		return this.workspaceStore
			.load()
			.map((workspace) => {
				this.finishStartupTraceIfPending(loadTraceIndex, "ok", null);
				// Always restore — panels gracefully handle missing projects/sessions.
				// This allows onboarding to import projects without clearing workspace.
				const restoreTraceIndex = this.beginStartupTrace("applyWorkspaceState");
				const restoredSessionIds = this.workspaceStore.restore(
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
				this.finishStartupTraceIfPending(restoreTraceIndex, "ok", null);
				return restoredSessionIds;
			})
			.mapErr(
				(error) => {
					this.finishStartupTraceIfPending(
						loadTraceIndex,
						"error",
						this.describeStartupTraceError(error)
					);
					return new InitializationError(
						"restoreWorkspace",
						error instanceof Error ? error : new Error(String(error))
					);
				}
			);
	}

	private loadAndValidateRestoredPanelSessions(
		restoredSessionIds: string[]
	): ResultAsync<void, MainAppViewError> {
		return this.sessionStore.loading
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
				this.healStartupPanelSessionIds(aliasRemaps);
				return this.validateRestoredSessions();
			})
			.map(() => undefined);
	}

	private scheduleRestoredPanelHydration(restoredSessionIds: string[]): void {
		this.schedulePostStartupWork(() => {
			void this.traceStartupResult(
				"background:hydrateStartupPanels",
				this.loadAndValidateRestoredPanelSessions(restoredSessionIds)
					.map(() => {
						this.scheduleRestoredPanelPreload();
						return undefined;
					})
					.orElse((error) => {
						logger.warn("Failed to hydrate restored panel sessions after startup", { error });
						return okAsync(undefined);
					})
			).match(
				() => undefined,
				() => undefined
			);
		});
	}

	/**
	 * One-time startup canonicalization for persisted panel session ids.
	 * Routes alias remaps through the guarded panel bind so duplicates collapse
	 * instead of silently overwriting the session index.
	 */
	private healStartupPanelSessionIds(aliasRemaps: Record<string, string>): void {
		for (const panel of this.panelStore.panels) {
			if (panel.sessionId === null) {
				continue;
			}

			const remappedCanonicalId = aliasRemaps[panel.sessionId];
			const resolverCanonicalId = this.sessionStore.read.resolveCanonicalSessionId(
				panel.sessionId
			);
			const canonicalId = remappedCanonicalId ?? resolverCanonicalId;

			if (canonicalId === null || canonicalId === undefined) {
				if (panel.sessionId in aliasRemaps) {
					continue;
				}
				logger.warn("Persisted panel session id could not be resolved to canonical", {
					panelId: panel.id,
					sessionId: panel.sessionId.substring(0, 8),
				});
				continue;
			}

			if (canonicalId !== panel.sessionId) {
				logger.debug("Healing persisted panel session id to canonical", {
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
			if (
				panel.sessionId &&
				(!this.sessionStore.read.getSessionIdentity(panel.sessionId) ||
					!this.sessionStore.read.getSessionMetadata(panel.sessionId))
			) {
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
	 * Creates sessions for panels that have an agent selected but no session.
	 * This ensures models/modes are loaded for restored panels with a selected agent.
	 *
	 * @returns ResultAsync indicating success or error
	 */
	private createSessionsForAgentOnlyPanels(): ResultAsync<void, MainAppViewError> {
		if (this.projectManager.projectStorageFresh === false) {
			return okAsync(undefined);
		}

		const projects = this.projectManager.projects;

		// Only auto-create sessions if there's exactly one project
		// (for multiple projects, user must select which project to use)
		if (projects.length !== 1) {
			return okAsync(undefined);
		}

		const project = projects[0];

		// Find panels with selectedAgentId but no session.
		// Provider metadata owns whether startup may create a session without a click.
		const panelsNeedingSessions = this.panelStore.panels.filter(
			(p) =>
				p.selectedAgentId &&
				!p.sessionId &&
				this.canCreateImplicitSessionForAgent(p.selectedAgentId)
		);

		// Create sessions for each panel (in background, don't block)
		for (const panel of panelsNeedingSessions) {
			this.sessionStore.connection
				.createSession({
					agentId: panel.selectedAgentId!,
					projectPath: project.path,
				})
				.map((createdSession) => {
					const currentPanel = this.panelStore.getPanel(panel.id);
					if (currentPanel === undefined || currentPanel.sessionId) {
						return;
					}
					const sessionId =
						createdSession.kind === "pending"
							? createdSession.sessionId
							: createdSession.session.id;
					this.panelStore.updatePanelSession(panel.id, sessionId);
				})
				.mapErr(() => {
					// Error state will be shown via status indicator
				});
		}

		return okAsync(undefined);
	}

	private canCreateImplicitSessionForAgent(agentId: string): boolean {
		const providerMetadata = this.agentStore.getProviderMetadata(agentId);
		if (providerMetadata === null || providerMetadata === undefined) {
			return false;
		}

		return providerMetadata.implicitSessionCreationMode !== "explicitUserAction";
	}

	/**
	 * Pre-loads restored panel session content after the app shell is usable,
	 * then reconnects the restored session so startup behavior matches manual open.
	 *
	 * When a panel's session is not yet in the local store (registry-only recovery),
	 * a minimal cold shell is seeded from persisted panel hints so that
	 * openPersistedSession can proceed. The canonical snapshot is applied by
	 * openPersistedSession itself via getSessionOpenResult.
	 */
	private earlyPreloadPanelSessions(): void {
		for (const panel of this.panelStore.panels) {
			if (!panel.sessionId) continue;

			const sessionIdentity = this.sessionStore.read.getSessionIdentity(panel.sessionId);
			const sessionMetadata = this.sessionStore.read.getSessionMetadata(panel.sessionId);
			if (!sessionIdentity || !sessionMetadata) {
				const projectPath = panel.projectPath;
				const agentId = panel.agentId;
				if (!projectPath || !agentId) {
					continue;
				}
				this.sessionStore.loading.registerSessionPlaceholder(panel.sessionId, projectPath, agentId, {
					sourcePath: panel.sourcePath ?? undefined,
					worktreePath: panel.worktreePath ?? undefined,
					placeholderTitle: panel.sessionTitle ?? undefined,
				});
			}

			openPersistedSession({
				panelId: panel.id,
				sessionId: panel.sessionId,
				sessionStore: this.sessionStore,
				sessionOpenHydrator: this.sessionOpenHydrator,
				isPanelCurrent: (targetPanelId, targetSessionId) =>
					this.panelStore.getPanel(targetPanelId)?.sessionId === targetSessionId,
				timeoutMs: SESSION_OPEN_TIMEOUT_MS,
				source: "initialization-manager",
			});
			}
		}

	private scheduleRestoredPanelPreload(): void {
		this.scheduleRestoredPanelPreloadWork(() => {
			const traceIndex = this.beginStartupTrace("background:preloadRestoredPanelSessions");
			this.earlyPreloadPanelSessions();
			this.finishStartupTraceIfPending(traceIndex, "ok", null);
		});
	}

	/**
	 * Cleans up initialization resources.
	 */
	cleanup(): void {
		this.keybindingsService.uninstall();
		this.state.initializationInProgress = false;
		this.state.initializationComplete = false;
		this.state.shellReady = false;
		this.splashResolutionPromise = null;
	}

	private hasTauriInvoke(): boolean {
		const tauriWindow = window as TauriWindow;
		return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function";
	}
}
