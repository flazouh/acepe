/**
 * Session Store - Consolidated session management.
 *
 * Single source of truth for all session state:
 * - sessions: SessionCold[] (cold data)
 * - hotState: Map<id, SessionHotState> (all transient state)
 * - entriesById: Map<id, SessionEntry[]> (messages)
 * - Event subscription handling (via SessionEventService)
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type { HistoryEntry } from "../../services/claude-history-types.js";
import type {
	ContentBlock,
	ContentChunk,
	PlanData,
	ToolCallData,
} from "../../services/converted-session-types.js";
import type { Attachment } from "../components/agent-input/types/attachment.js";
import type { AppError } from "../errors/app-error.js";
import type { SessionMachineSnapshot } from "../logic/session-machine";
import {
	deriveSessionRuntimeState,
	deriveSessionUIState,
	type SessionRuntimeState,
	type SessionUIState,
} from "../logic/session-ui-state";
import type { AvailableCommand } from "../types/available-command.js";
import type { PermissionRequest } from "../types/permission";
import type { QuestionRequest } from "../types/question";
import type { SessionUpdate } from "../types/session-update";
import type { ToolCallUpdate } from "../types/tool-call";
import type { TurnErrorPayload } from "../types/turn-error.js";
import type { ISessionStateReader, ISessionStateWriter } from "./services/interfaces/index.js";
import {
	SessionConnectionService,
	type SessionMachineActor,
} from "./session-connection-service.svelte.js";
import type { SessionEventHandler } from "./session-event-handler.js";
import {
	SessionEventService,
	type SessionEventServiceCallbacks,
} from "./session-event-service.svelte.js";
import type {
	SessionCapabilities,
	SessionCold,
	SessionEntry,
	SessionHotState,
	SessionIdentity,
	SessionMetadata,
} from "./types.js";
import "../errors/app-error.js";
import type { PrDetails } from "../../utils/tauri-client/git.js";
import { tauriClient } from "../../utils/tauri-client.js";
import { normalizeModeIdForUI } from "../constants/mode-mapping.js";
import { SessionNotFoundError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import * as preferencesStore from "./agent-model-preferences-store.svelte.js";
import { api } from "./api.js";
import { OperationStore } from "./operation-store.svelte.js";
import { SessionConnectionManager } from "./services/session-connection-manager.js";
import { SessionMessagingService } from "./services/session-messaging-service.js";
import { SessionRepository } from "./services/session-repository.js";
import { SessionCapabilitiesStore } from "./session-capabilities-store.svelte.js";
import { SessionEntryStore } from "./session-entry-store.svelte.js";
import { SessionHotStateStore } from "./session-hot-state-store.svelte.js";
import { getTitleUpdateFromUserMessage } from "./session-title-policy.js";

const logger = createLogger({ id: "session-store", name: "SessionStore" });

const SESSION_STORE_KEY = Symbol("session-store");
const PR_STATE_CACHE_TTL_MS = 60_000;

interface CachedPrDetails {
	details: PrDetails;
	fetchedAt: number;
}

/**
 * Callbacks for handling permission and question requests.
 * These are set during initialization to avoid circular dependencies.
 */
export interface SessionStoreCallbacks {
	onPermissionRequest?: (permission: PermissionRequest) => void;
	onQuestionRequest?: (question: QuestionRequest) => void;
	onPlanUpdate?: (sessionId: string, planData: PlanData) => void;
	onTurnComplete?: (sessionId: string) => void;
	onTurnInterrupted?: (sessionId: string) => void;
	onTurnError?: (sessionId: string) => void;
	/** Called when a PR number is discovered in agent messages (e.g. Claude created a PR autonomously). */
	onPrNumberFound?: (sessionId: string, prNumber: number) => void;
}

export class SessionStore implements SessionEventHandler, ISessionStateReader, ISessionStateWriter {
	// === PRIMARY STATE ===
	sessions = $state<SessionCold[]>([]);
	loading = $state(false);

	/** Project paths currently being scanned for sessions (for per-project skeleton display). */
	readonly scanningProjectPaths = new SvelteSet<string>();

	// Callbacks invoked when a session is removed (e.g., plan store cleanup)
	private readonly onRemoveCallbacks: Array<(sessionId: string) => void> = [];

	// Hot state store (batched transient state)
	private readonly hotStateStore = new SessionHotStateStore();

	// Capabilities store (ACP configuration - models, modes, commands)
	private readonly capabilitiesStore = new SessionCapabilitiesStore();

	// Canonical tool execution domain state
	private readonly operationStore = new OperationStore();

	// Entry store (entries + chunk aggregation)
	private readonly entryStore = new SessionEntryStore(this.operationStore);

	// PR details cache/dedupe (prevents repeated gh pr view storms during scans)
	private readonly prDetailsCache = new Map<string, CachedPrDetails>();
	private readonly prDetailsInflight = new Map<string, ResultAsync<PrDetails | null, never>>();

	// Connection service (state machines + connection tracking)
	private readonly connectionService = new SessionConnectionService();

	// Repository for CRUD and loading operations
	private readonly repository: SessionRepository;

	// Connection manager for connection lifecycle
	private readonly connectionMgr: SessionConnectionManager;

	// Messaging service for message sending and streaming
	private readonly messagingSvc: SessionMessagingService;

	// === SERVICES ===
	private eventService: SessionEventService;
	private callbacks: SessionStoreCallbacks = {};

	// === DERIVED LOOKUPS ===
	readonly sessionById = $derived.by(() => {
		return new Map(this.sessions.map((s) => [s.id, s]));
	});

	readonly sessionsByProject = $derived.by(() => {
		const map = new Map<string, SessionCold[]>();
		for (const s of this.sessions) {
			let arr = map.get(s.projectPath);
			if (!arr) {
				arr = [];
				map.set(s.projectPath, arr);
			}
			arr.push(s);
		}
		return map;
	});

	constructor() {
		this.eventService = new SessionEventService();
		// Create repository with this store as the state reader/writer
		this.repository = new SessionRepository(this, this, this.entryStore, this.connectionService);
		// Create connection manager
		this.connectionMgr = new SessionConnectionManager(
			this,
			this,
			this.hotStateStore,
			this.capabilitiesStore,
			this.entryStore,
			this.connectionService,
			this.eventService
		);
		// Create messaging service
		this.messagingSvc = new SessionMessagingService(
			this,
			this.hotStateStore,
			this.entryStore,
			this.connectionService
		);
	}

	// ============================================
	// ISessionStateWriter IMPLEMENTATION
	// ============================================

	/**
	 * Set sessions array (for bulk operations).
	 */
	setSessions(sessions: SessionCold[]): void {
		this.sessions = sessions;
	}

	/**
	 * Set loading state.
	 */
	setLoading(loading: boolean): void {
		this.loading = loading;
	}

	/**
	 * Mark project paths as currently being scanned.
	 */
	addScanningProjects(paths: string[]): void {
		for (const p of paths) {
			this.scanningProjectPaths.add(p);
		}
	}

	/**
	 * Clear scanning state for project paths.
	 */
	removeScanningProjects(paths: string[]): void {
		for (const p of paths) {
			this.scanningProjectPaths.delete(p);
		}
	}

	// ============================================
	// ISessionStateReader IMPLEMENTATION
	// ============================================

	/**
	 * Get all sessions (cold data only).
	 */
	getAllSessions(): SessionCold[] {
		return this.sessions;
	}

	// ============================================
	// CALLBACKS
	// ============================================

	/**
	 * Set callbacks for handling permission and question requests.
	 */
	setCallbacks(callbacks: SessionStoreCallbacks): void {
		this.callbacks = callbacks;
		const eventCallbacks: SessionEventServiceCallbacks = {
			onPermissionRequest: callbacks.onPermissionRequest,
			onQuestionRequest: callbacks.onQuestionRequest,
			onPlanUpdate: callbacks.onPlanUpdate,
			onTurnComplete: callbacks.onTurnComplete,
		};
		this.eventService.setCallbacks(eventCallbacks);
	}

	// ============================================
	// SESSION RETRIEVAL
	// ============================================

	/**
	 * Get hot state for a session.
	 */
	getHotState(sessionId: string): SessionHotState {
		return this.hotStateStore.getHotState(sessionId);
	}

	/**
	 * Get capabilities for a session.
	 * Returns default (empty) capabilities if not connected to ACP.
	 */
	getCapabilities(sessionId: string): SessionCapabilities {
		return this.capabilitiesStore.getCapabilities(sessionId);
	}

	/**
	 * Get session identity (immutable lookup keys).
	 */
	getSessionIdentity(sessionId: string): SessionIdentity | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) return undefined;
		return {
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: session.worktreePath,
		};
	}

	/**
	 * Get session metadata (rarely changing data).
	 */
	getSessionMetadata(sessionId: string): SessionMetadata | undefined {
		const session = this.sessionById.get(sessionId);
		if (!session) return undefined;
		return {
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			sourcePath: session.sourcePath,
			parentId: session.parentId,
			prNumber: session.prNumber,
			prState: session.prState,
			worktreeDeleted: session.worktreeDeleted,
			sequenceId: session.sequenceId,
		};
	}

	/**
	 * Get session cold data by ID from the lookup map (O(1)).
	 */
	getSessionCold(sessionId: string): SessionCold | undefined {
		return this.sessionById.get(sessionId);
	}

	/**
	 * Get sessions for a project (cold data only).
	 */
	getSessionsForProject(projectPath: string): SessionCold[] {
		return this.sessionsByProject.get(projectPath) || [];
	}

	/**
	 * Check if a session exists and has been preloaded (entries loaded from disk).
	 * Returns the cold session data if preloaded, null otherwise.
	 */
	getSessionDetail(sessionId: string): SessionCold | null {
		const session = this.getSessionCold(sessionId);
		if (!session) {
			return null;
		}
		if (!this.entryStore.isPreloaded(sessionId)) {
			return null;
		}
		return session;
	}

	/**
	 * Get entries for a session.
	 */
	getEntries(sessionId: string): SessionEntry[] {
		return this.entryStore.getEntries(sessionId);
	}

	getOperationStore(): OperationStore {
		return this.operationStore;
	}

	/**
	 * Check if session is preloaded.
	 */
	isPreloaded(sessionId: string): boolean {
		return this.entryStore.isPreloaded(sessionId);
	}

	// ============================================
	// SESSION STATE MACHINE MANAGEMENT (delegated to connectionService)
	// ============================================

	/**
	 * Get session machine for a session.
	 */
	getSessionMachine(sessionId: string): SessionMachineActor | null {
		return this.connectionService.getMachine(sessionId);
	}

	/**
	 * Get session machine state.
	 */
	getSessionState(sessionId: string): SessionMachineSnapshot | null {
		return this.connectionService.getState(sessionId);
	}

	/**
	 * Get derived UI state for a session.
	 * Derives directly from the XState machine - single source of truth.
	 */
	getSessionUIState(sessionId: string): SessionUIState | null {
		const state = this.connectionService.getState(sessionId);
		if (!state) return null;
		return deriveSessionUIState(state);
	}

	/**
	 * Get canonical runtime state for a session.
	 * This is the single lifecycle contract for panel/input/queue consumers.
	 */
	getSessionRuntimeState(sessionId: string): SessionRuntimeState | null {
		// Reactive anchor: XState machine snapshots are imperative (plain Map),
		// invisible to Svelte's signal graph. Every machine transition is paired
		// with a hot-state update, so reading hot state here ensures $derived
		// callers re-evaluate when the machine moves.

		this.hotStateStore.getHotState(sessionId);

		const state = this.connectionService.getState(sessionId);
		if (!state) return null;

		const entries = this.entryStore.getEntries(sessionId);
		const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
		return deriveSessionRuntimeState(state, lastEntry);
	}

	// ============================================
	// SESSION LOADING STATUS
	// ============================================

	/**
	 * Set session status to loading (for async content loading).
	 */
	setSessionLoading(sessionId: string): void {
		this.hotStateStore.updateHotState(sessionId, { status: "loading" });
	}

	/**
	 * Mark session as loaded (entries fetched from disk).
	 */
	setSessionLoaded(sessionId: string): void {
		const hotState = this.getHotState(sessionId);
		// Only transition if currently loading
		if (hotState.status === "loading") {
			this.hotStateStore.updateHotState(sessionId, { status: "idle" });
		}
	}

	// ============================================
	// SESSION CRUD (ISessionStateWriter implementation + delegation to repository)
	// ============================================

	/**
	 * Add a session to the store.
	 */
	addSession(session: SessionCold): void {
		this.sessions = [session, ...this.sessions];
		logger.debug("Added session", { sessionId: session.id });
	}

	/**
	 * Remove a session from the store.
	 * Used to clean up orphaned sessions (metadata exists but content is missing).
	 */
	removeSession(sessionId: string): void {
		this.repository.removeSession(sessionId);
		this.hotStateStore.removeHotState(sessionId);
		this.capabilitiesStore.removeCapabilities(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
		preferencesStore.clearSessionModelPerMode(sessionId);
		for (const cb of this.onRemoveCallbacks) {
			cb(sessionId);
		}
	}

	/**
	 * Clear cached entries/runtime for a session without removing session metadata.
	 * Used to force a fresh reload from disk for historical sessions.
	 */
	clearSessionEntries(sessionId: string): void {
		this.entryStore.clearEntries(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
	}

	/**
	 * Register a callback to run when a session is removed.
	 * Used by external stores (e.g., PlanStore) for cleanup.
	 */
	onSessionRemoved(callback: (sessionId: string) => void): void {
		this.onRemoveCallbacks.push(callback);
	}

	/**
	 * Update a session's cold data by ID (creates new array for reactivity).
	 */
	updateSession(
		id: string,
		updates: Partial<SessionCold>,
		options?: { touchUpdatedAt?: boolean }
	): void {
		this.sessions = this.sessions.map((s) =>
			s.id === id
				? {
						...s,
						...updates,
						updatedAt:
							updates.updatedAt !== undefined
								? updates.updatedAt
								: options?.touchUpdatedAt === false
									? s.updatedAt
									: new Date(),
					}
				: s
		);
	}

	renameSession(sessionId: string, title: string): ResultAsync<void, AppError> {
		const session = this.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const trimmedTitle = title.trim();
		if (trimmedTitle === "" || trimmedTitle === session.title) {
			return okAsync(undefined);
		}

		return api.setSessionTitle(sessionId, trimmedTitle).map(() => {
			this.updateSession(
				sessionId,
				{
					title: trimmedTitle,
				},
				{ touchUpdatedAt: false }
			);
			return undefined;
		});
	}

	// ============================================
	// SESSION LOADING (delegated to repository)
	// ============================================

	/**
	 * Load sessions from history (from ALL agents).
	 */
	loadSessions(projectPaths?: string[]): ResultAsync<SessionCold[], AppError> {
		return this.repository.loadSessions(this.sessions, projectPaths).map((sessions) => {
			// After loading, refresh PR states from GitHub for all sessions with a PR number.
			// Fire-and-forget — sidebar badges update as each fetch completes.
			this.refreshAllPrStates();
			return sessions;
		});
	}

	/**
	 * Scan project sessions from all agents and refresh the store.
	 */
	scanSessions(projectPaths: string[]): ResultAsync<void, AppError> {
		return this.repository.scanSessions(this.sessions, projectPaths).map(() => {
			this.refreshAllPrStates();
		});
	}

	/**
	 * Refresh sessions from a batch scan result.
	 */
	refreshSessionsFromScan(entries: HistoryEntry[]): void {
		this.repository.refreshSessionsFromScan(this.sessions, entries);
	}

	/**
	 * Load startup sessions (hydrate sessions that should be open at startup).
	 */
	loadStartupSessions(
		sessionIds: string[]
	): ResultAsync<{ missing: string[]; aliasRemaps: Record<string, string> }, AppError> {
		return this.repository.loadStartupSessions(this.sessions, sessionIds);
	}

	/**
	 * Preload full session details from disk.
	 */
	preloadSessions(
		sessionIds: string[]
	): ResultAsync<{ loaded: SessionCold[]; missing: string[] }, AppError> {
		return this.repository.preloadSessions(sessionIds);
	}

	/**
	 * Load a session directly by ID with its context.
	 */
	loadSessionById(
		sessionId: string,
		projectPath: string,
		agentId: string,
		sourcePath?: string,
		worktreePath?: string,
		placeholderTitle?: string
	): ResultAsync<SessionCold, AppError> {
		return this.repository
			.loadSessionById(
				sessionId,
				projectPath,
				agentId,
				sourcePath,
				worktreePath,
				(id) => this.setSessionLoading(id),
				(id) => this.setSessionLoaded(id),
				placeholderTitle
			)
			.map((session) => session);
	}

	/**
	 * Load a historical session from disk.
	 */
	loadHistoricalSession(
		id: string,
		projectPath: string,
		title: string,
		agentId: string,
		sourcePath?: string,
		sequenceId?: number,
		worktreePath?: string
	): ResultAsync<SessionCold, AppError> {
		return this.repository.loadHistoricalSession(
			id,
			projectPath,
			title,
			agentId,
			sourcePath,
			sequenceId,
			undefined,
			worktreePath
		);
	}

	// ============================================
	// SESSION CONNECTION (delegated to connection manager)
	// ============================================

	/**
	 * Create a new session and connect to ACP.
	 */
	createSession(options: {
		projectPath: string;
		agentId: string;
		title?: string;
		initialAutonomousEnabled?: boolean;
		initialModeId?: string;
		initialModelId?: string;
		worktreePath?: string;
	}): ResultAsync<SessionCold, AppError> {
		return this.connectionMgr.createSession(options, this);
	}

	/**
	 * Connect to a session (resume or create ACP connection).
	 */
	connectSession(sessionId: string): ResultAsync<SessionCold, AppError> {
		return this.connectionMgr.connectSession(sessionId, this);
	}

	/**
	 * Disconnect a session.
	 */
	disconnectSession(sessionId: string): void {
		this.connectionMgr.disconnectSession(sessionId);
		this.messagingSvc.clearSessionState(sessionId);
	}

	/**
	 * Disconnect all connected sessions.
	 * Used for cleanup when the app window closes.
	 */
	disconnectAllSessions(): void {
		// Read connection status from hot state, not cold state
		const connectedSessions = this.sessions.filter(
			(s) => this.hotStateStore.getHotState(s.id).isConnected
		);
		for (const session of connectedSessions) {
			this.disconnectSession(session.id);
		}
	}

	// ============================================
	// MODEL/MODE (delegated to connection manager)
	// ============================================

	/**
	 * Set model for a session (optimistic update with rollback).
	 */
	setModel(sessionId: string, modelId: string): ResultAsync<void, AppError> {
		return this.connectionMgr.setModel(sessionId, modelId);
	}

	/**
	 * Set mode for a session (optimistic update with rollback).
	 */
	setMode(sessionId: string, modeId: string): ResultAsync<void, AppError> {
		return this.connectionMgr.setMode(sessionId, modeId);
	}

	setAutonomousEnabled(sessionId: string, enabled: boolean): ResultAsync<void, AppError> {
		return this.connectionMgr.setAutonomousEnabled(sessionId, enabled, this);
	}

	setConfigOption(sessionId: string, configId: string, value: string): ResultAsync<void, AppError> {
		return this.connectionMgr.setConfigOption(sessionId, configId, value);
	}

	/**
	 * Cancel streaming for a session.
	 */
	cancelStreaming(sessionId: string): ResultAsync<void, AppError> {
		return this.connectionMgr.cancelStreaming(sessionId).map(() => {
			this.callbacks.onTurnInterrupted?.(sessionId);
			return undefined;
		});
	}

	// ============================================
	// MESSAGING (delegated to messaging service)
	// ============================================

	/**
	 * Send a message to a session.
	 */
	sendMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[] = []
	): ResultAsync<void, AppError> {
		const session = this.getSessionCold(sessionId);
		if (!session) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		logger.info("sendMessage: store entrypoint", {
			sessionId,
			isConnected: this.hotStateStore.getHotState(sessionId).isConnected,
			entryCountBeforeSend: this.entryStore.getEntries(sessionId).length,
			preview: content.trim().slice(0, 120),
		});

		const send = () =>
			this.messagingSvc.sendMessage(sessionId, content, attachments).map(() => {
				const currentTitle = this.getSessionCold(sessionId)?.title;
				logger.debug("[sendMessage] After message sent, checking title update", {
					sessionId,
					currentTitle: currentTitle?.substring(0, 100),
				});
				if (!currentTitle) {
					logger.debug("[sendMessage] No current title, skipping title update");
					return;
				}

				const derivedTitle = getTitleUpdateFromUserMessage(currentTitle, content);
				logger.debug("[sendMessage] Title derivation result", {
					derivedTitle,
					willUpdate: !!derivedTitle,
				});
				if (!derivedTitle) {
					logger.debug("[sendMessage] No derived title, skipping update");
					return;
				}

				logger.debug("[sendMessage] Updating session title", { derivedTitle });
				this.updateSession(sessionId, { title: derivedTitle });
			});

		return send();
	}

	// ============================================
	// STREAMING (delegated to messaging service)
	// ============================================

	/**
	 * Handle incoming stream entry from Tauri events.
	 */
	handleStreamEntry(sessionId: string, entry: SessionEntry): void {
		this.messagingSvc.handleStreamEntry(sessionId, entry);
	}

	/**
	 * Handle stream complete from Tauri events.
	 */
	handleStreamComplete(sessionId: string): void {
		this.messagingSvc.handleStreamComplete(sessionId);
	}

	/**
	 * Handle stream error from Tauri events.
	 */
	handleStreamError(sessionId: string, error: Error): void {
		this.messagingSvc.handleStreamError(sessionId, error);
	}

	/**
	 * Handle turn error from agent (e.g., usage limit reached).
	 */
	handleTurnError(sessionId: string, error: TurnErrorPayload): void {
		this.messagingSvc.handleTurnError(sessionId, error);
		this.callbacks.onTurnError?.(sessionId);
	}

	clearStreamingAssistantEntry(sessionId: string): void {
		this.entryStore.clearStreamingAssistantEntry(sessionId);
	}

	// ============================================
	// PR STATE REFRESH
	// ============================================

	/**
	 * Fetch the current PR state from GitHub for a single session and update the store.
	 * Returns the full PrDetails if fetch succeeds, null otherwise.
	 */
	refreshSessionPrState(
		sessionId: string,
		projectPath: string,
		prNumber: number
	): ResultAsync<PrDetails | null, never> {
		if (prNumber <= 0) {
			return okAsync<PrDetails | null, never>(null);
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const cachedDetails = this.getFreshCachedPrDetails(cacheKey);
		if (cachedDetails) {
			this.applyPrDetailsToSessions(projectPath, prNumber, cachedDetails);
			return okAsync<PrDetails | null, never>(cachedDetails);
		}

		const inflightRequest = this.prDetailsInflight.get(cacheKey);
		if (inflightRequest) {
			return inflightRequest;
		}

		logger.debug("refreshSessionPrState: calling prDetails", { sessionId, projectPath, prNumber });
		const request = tauriClient.git
			.prDetails(projectPath, prNumber)
			.map((details): PrDetails | null => {
				this.prDetailsCache.set(cacheKey, {
					details,
					fetchedAt: Date.now(),
				});
				this.prDetailsInflight.delete(cacheKey);
				logger.info("refreshSessionPrState: got details", {
					sessionId,
					detailsState: details.state,
				});
				this.applyPrDetailsToSessions(projectPath, prNumber, details);
				return details;
			})
			.orElse((err) => {
				this.prDetailsInflight.delete(cacheKey);
				logger.warn("Failed to fetch PR details", {
					sessionId,
					prNumber,
					error: err.message,
				});
				return okAsync<PrDetails | null, never>(null);
			});

		this.prDetailsInflight.set(cacheKey, request);
		return request;
	}

	/**
	 * Refresh PR state from GitHub for all sessions that have a prNumber.
	 * Fire-and-forget — errors are logged but not propagated.
	 */
	refreshAllPrStates(): void {
		const sessionsWithPr = this.sessions.filter((s) => s.prNumber != null);
		for (const session of sessionsWithPr) {
			void this.refreshSessionPrState(session.id, session.projectPath, session.prNumber!);
		}
	}

	private getPrDetailsCacheKey(projectPath: string, prNumber: number): string {
		return `${projectPath}::${prNumber}`;
	}

	private getFreshCachedPrDetails(cacheKey: string): PrDetails | null {
		const cachedEntry = this.prDetailsCache.get(cacheKey);
		if (!cachedEntry) {
			return null;
		}

		if (Date.now() - cachedEntry.fetchedAt > PR_STATE_CACHE_TTL_MS) {
			this.prDetailsCache.delete(cacheKey);
			return null;
		}

		return cachedEntry.details;
	}

	private applyPrDetailsToSessions(
		projectPath: string,
		prNumber: number,
		details: PrDetails
	): void {
		const matchingSessions = this.sessions.filter(
			(session) => session.projectPath === projectPath && session.prNumber === prNumber
		);

		if (matchingSessions.length === 0) {
			logger.warn("refreshSessionPrState: session not found", { projectPath, prNumber });
			return;
		}

		for (const session of matchingSessions) {
			if (details.state !== session.prState) {
				logger.info("refreshSessionPrState: updating session prState", {
					sessionId: session.id,
					oldState: session.prState,
					newState: details.state,
				});
				this.updateSession(session.id, { prState: details.state }, { touchUpdatedAt: false });
				continue;
			}

			logger.debug("refreshSessionPrState: state unchanged, skipping", {
				sessionId: session.id,
				currentState: session.prState,
				newState: details.state,
			});
		}
	}

	updateCurrentMode(sessionId: string, modeId: string): void {
		const agentId = this.getSessionCold(sessionId)?.agentId;
		const normalizedId = normalizeModeIdForUI(modeId, agentId);
		const capabilities = this.capabilitiesStore.getCapabilities(sessionId);
		const newMode = capabilities.availableModes.find((m) => m.id === normalizedId) ?? null;
		this.hotStateStore.updateHotState(sessionId, { currentMode: newMode });
	}

	updateConfigOptions(
		sessionId: string,
		configOptions: import("../../services/converted-session-types.js").ConfigOptionData[]
	): void {
		this.hotStateStore.updateHotState(sessionId, { configOptions });
	}

	updateUsageTelemetry(
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	): void {
		this.hotStateStore.updateHotState(sessionId, { usageTelemetry: telemetry });
	}

	/**
	 * Handle session update from EventSubscriber.
	 */
	handleSessionUpdate(update: SessionUpdate): void {
		this.eventService.handleSessionUpdate(update, this);
	}

	// ============================================
	// TOOL CALLS (delegated to messaging service)
	// ============================================

	/**
	 * Create a new tool call entry from full ToolCallData.
	 */
	createToolCallEntry(sessionId: string, toolCallData: ToolCallData): void {
		this.messagingSvc.createToolCallEntry(sessionId, toolCallData);
	}

	/**
	 * Update tool call entry.
	 */
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void {
		this.messagingSvc.updateToolCallEntry(sessionId, update);
	}

	/**
	 * Get the streaming arguments for a tool call.
	 */
	getStreamingArguments(
		toolCallId: string
	): import("$lib/services/converted-session-types.js").ToolArguments | undefined {
		return this.entryStore.getStreamingArguments(toolCallId);
	}

	/**
	 * Update available commands.
	 */
	updateAvailableCommands(sessionId: string, commands: AvailableCommand[]): void {
		this.messagingSvc.updateAvailableCommands(sessionId, commands);
	}

	/**
	 * Ensure streaming state is set.
	 */
	ensureStreamingState(sessionId: string): void {
		this.messagingSvc.ensureStreamingState(sessionId);
	}

	// ============================================
	// CHUNK AGGREGATION (delegated to messaging service)
	// ============================================

	/**
	 * Aggregate assistant chunk.
	 */
	aggregateAssistantChunk(
		sessionId: string,
		chunk: ContentChunk,
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError> {
		return this.messagingSvc.aggregateAssistantChunk(sessionId, chunk, messageId, isThought);
	}

	aggregateUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError> {
		return this.entryStore.aggregateUserChunk(sessionId, chunk);
	}

	// ============================================
	// EVENT SUBSCRIPTION
	// ============================================

	/**
	 * Initialize session update subscription.
	 */
	initializeSessionUpdates(): ResultAsync<void, AppError> {
		return this.eventService.initializeSessionUpdates(this);
	}

	/**
	 * Cleanup session update subscription.
	 */
	cleanupSessionUpdates(): void {
		this.eventService.cleanupSessionUpdates();
	}
}

/**
 * Create and set the session store in Svelte context.
 */
export function createSessionStore(): SessionStore {
	const store = new SessionStore();
	setContext(SESSION_STORE_KEY, store);

	return store;
}

/**
 * Get the session store from Svelte context.
 */
export function getSessionStore(): SessionStore {
	return getContext<SessionStore>(SESSION_STORE_KEY);
}
