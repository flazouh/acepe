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
import {
	normalizeModelsForDisplay,
	resolveProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type { HistoryEntry } from "../../services/claude-history-types.js";
import type {
	ContentBlock,
	ContentChunk,
	PlanData,
	ToolCallData,
} from "../../services/converted-session-types.js";
import type {
	SessionOpenFound,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
	SessionStateEnvelope,
	SessionTurnState,
	TurnFailureSnapshot,
	TranscriptDelta,
} from "../../services/acp-types.js";
import { routeSessionStateEnvelope } from "../session-state/session-state-command-router.js";
import type { Attachment } from "../components/agent-input/types/attachment.js";
import type { AppError } from "../errors/app-error.js";
import type { ComposerMachineEvent } from "../logic/composer-machine.js";
import type { SessionMachineSnapshot } from "../logic/session-machine";
import {
	deriveStoreComposerState,
	type StoreComposerState,
} from "../logic/composer-ui-state.js";
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
import type { ActiveTurnFailure, TurnCompleteUpdate, TurnErrorUpdate } from "../types/turn-error.js";
import type { ISessionStateReader, ISessionStateWriter } from "./services/interfaces/index.js";
import { ComposerMachineService } from "./composer-machine-service.svelte.js";
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
	Mode,
	Model,
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

type ProjectionTurnFailure = {
	readonly turn_id?: TurnFailureSnapshot["turn_id"];
	readonly message: TurnFailureSnapshot["message"];
	readonly code?: TurnFailureSnapshot["code"];
	readonly kind: TurnFailureSnapshot["kind"];
	readonly source?: TurnFailureSnapshot["source"] | null;
};

type CreatedSessionHydrator = {
	hydrateCreated(found: SessionOpenFound): ResultAsync<void, AppError>;
};

type LiveSessionStateGraphConsumer = {
	replaceSessionStateGraph(graph: SessionStateGraph): void;
};

type InflightSessionStateRefresh = ResultAsync<void, AppError>;

function mapProjectionTurnState(turnState: SessionTurnState):
	| "idle"
	| "streaming"
	| "completed"
	| "error" {
	switch (turnState) {
		case "Idle":
			return "idle";
		case "Running":
			return "streaming";
		case "Completed":
			return "completed";
		case "Failed":
			return "error";
	}
}

function mapProjectionTurnFailure(
	failure: ProjectionTurnFailure | null | undefined
): ActiveTurnFailure | null {
	if (failure == null) {
		return null;
	}

	return {
		turnId: failure.turn_id ?? null,
		message: failure.message,
		code: failure.code ?? null,
		kind: failure.kind,
		source: failure.source ?? "unknown",
	};
}
const PR_STATE_CACHE_TTL_MS = 60_000;

interface CachedPrDetails {
	details: PrDetails;
	fetchedAt: number;
}

function normalizeCanonicalAgentId(agentId: SessionOpenFound["agentId"]): string {
	return typeof agentId === "string" ? agentId : agentId.custom;
}

function toFrontendTurnState(turnState: SessionTurnState): SessionHotState["turnState"] {
	switch (turnState) {
		case "Idle":
			return "idle";
		case "Running":
			return "streaming";
		case "Completed":
			return "completed";
		case "Failed":
			return "error";
	}
}

function toSessionStatusFromGraphLifecycle(
	lifecycle: SessionGraphLifecycle
): SessionHotState["status"] {
	switch (lifecycle.status) {
		case "idle":
			return "idle";
		case "connecting":
			return "connecting";
		case "ready":
			return "ready";
		case "error":
			return "error";
	}
}

function mapGraphAvailableModels(
	capabilities: SessionGraphCapabilities
): Array<Model> {
	const availableModels = capabilities.models?.availableModels ?? [];
	return availableModels.map((model) => ({
		id: model.modelId,
		name: model.name,
		description: model.description ?? undefined,
	}));
}

function mapGraphAvailableModes(
	capabilities: SessionGraphCapabilities
): Array<Mode> {
	const availableModes = capabilities.modes?.availableModes ?? [];
	return availableModes.map((mode) => ({
		id: mode.id,
		name: mode.name,
		description: mode.description ?? undefined,
	}));
}

function projectGraphCapabilities(
	agentId: string,
	capabilities: SessionGraphCapabilities
): {
	availableModels: Array<Model>;
	availableModes: Array<Mode>;
	availableCommands: AvailableCommand[];
	currentModel: Model | null;
	currentMode: Mode | null;
	modelsDisplay: ModelsForDisplay | undefined;
	providerMetadata: ProviderMetadataProjection;
	configOptions: SessionHotState["configOptions"];
} {
	const availableModels = mapGraphAvailableModels(capabilities);
	const availableModes = mapGraphAvailableModes(capabilities);
	const providerMetadata = resolveProviderMetadataProjection(
		agentId,
		capabilities.models?.providerMetadata ?? null,
		agentId
	);
	const normalizedModelsDisplay =
		normalizeModelsForDisplay(
			agentId,
			capabilities.models?.modelsDisplay ?? null,
			agentId,
			providerMetadata
		) ?? null;
	const modelsDisplay =
		normalizedModelsDisplay === null ? undefined : normalizedModelsDisplay;
	const normalizedCurrentModeId = capabilities.modes?.currentModeId
		? normalizeModeIdForUI(capabilities.modes.currentModeId, agentId)
		: null;
	const currentMode =
		normalizedCurrentModeId === null
			? null
			: availableModes.find((mode) => mode.id === normalizedCurrentModeId) ?? null;
	const currentModelId = capabilities.models?.currentModelId ?? null;
	const currentModel =
		currentModelId === null
			? null
			: availableModels.find((model) => model.id === currentModelId) ?? null;

	return {
		availableModels,
		availableModes,
		availableCommands: capabilities.availableCommands ?? [],
		currentModel,
		currentMode,
		modelsDisplay,
		providerMetadata,
		configOptions: capabilities.configOptions,
	};
}

function connectionErrorFromGraphState(
	lifecycle: SessionGraphLifecycle,
	activeTurnFailure: ActiveTurnFailure | null
): string | null {
	if (lifecycle.status === "error") {
		return lifecycle.errorMessage ?? null;
	}

	if (activeTurnFailure !== null) {
		return null;
	}

	return null;
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
	private sessionOpenHydrator: CreatedSessionHydrator | null = null;
	private liveSessionStateGraphConsumer: LiveSessionStateGraphConsumer | null = null;
	private readonly inflightSessionStateRefreshes = new Map<string, InflightSessionStateRefresh>();

	// PR details cache/dedupe (prevents repeated gh pr view storms during scans)
	private readonly prDetailsCache = new Map<string, CachedPrDetails>();
	private readonly prDetailsInflight = new Map<string, ResultAsync<PrDetails | null, never>>();

	// Connection service (state machines + connection tracking)
	private readonly connectionService = new SessionConnectionService();

	// Composer policy actors (submit/config/dispatch gating)
	private readonly composerMachineService = new ComposerMachineService((sessionId) =>
		this.getHotState(sessionId)
	);

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

	/**
	 * Canonical composer policy for a session (config block, dispatch, selector disables).
	 * Reactive: subscribes to composer machine snapshots and runtime state.
	 */
	getStoreComposerState(sessionId: string): StoreComposerState | null {
		this.hotStateStore.getHotState(sessionId);
		const snapshot = this.composerMachineService.getState(sessionId);
		if (!snapshot) {
			return null;
		}
		return deriveStoreComposerState({
			machineSnapshot: snapshot,
			runtime: this.getSessionRuntimeState(sessionId),
		});
	}

	/**
	 * Re-seed composer committed state from hot state (call when panel binds / session changes).
	 * Ensures the per-session actor exists before binding.
	 */
	bindComposerSession(sessionId: string): void {
		this.composerMachineService.createOrGetActor(sessionId);
		this.composerMachineService.bindSession(sessionId);
	}

	runComposerConfigOperation(
		sessionId: string,
		beginPayload: Omit<Extract<ComposerMachineEvent, { type: "CONFIG_BLOCK_BEGIN" }>, "type">,
		operation: () => Promise<boolean>
	): Promise<boolean> {
		return this.composerMachineService.runConfigOperation(sessionId, beginPayload, operation);
	}

	composerBeginDispatch(sessionId: string): void {
		this.composerMachineService.beginDispatch(sessionId);
	}

	composerEndDispatch(sessionId: string): void {
		this.composerMachineService.endDispatch(sessionId);
	}

	applySessionStateGraph(graph: SessionStateGraph): void {
		const normalizedAgentId = normalizeCanonicalAgentId(graph.agentId);
		const projectedCapabilities = projectGraphCapabilities(normalizedAgentId, graph.capabilities);
		const activeTurnFailure = mapProjectionTurnFailure(graph.activeTurnFailure ?? null);
		this.capabilitiesStore.updateCapabilities(graph.canonicalSessionId, {
			availableModes: projectedCapabilities.availableModes,
			availableModels: projectedCapabilities.availableModels,
			availableCommands: projectedCapabilities.availableCommands,
			modelsDisplay: projectedCapabilities.modelsDisplay,
			providerMetadata: projectedCapabilities.providerMetadata,
		});
		const updates: Partial<import("./types.js").SessionHotState> = {
			status: toSessionStatusFromGraphLifecycle(graph.lifecycle),
			isConnected: graph.lifecycle.status === "ready",
			acpSessionId:
				graph.lifecycle.status === "ready" ? graph.canonicalSessionId : null,
			turnState: mapProjectionTurnState(graph.turnState),
			activeTurnFailure,
			lastTerminalTurnId: graph.lastTerminalTurnId ?? null,
			connectionError: connectionErrorFromGraphState(graph.lifecycle, activeTurnFailure),
			currentMode: projectedCapabilities.currentMode,
			currentModel: projectedCapabilities.currentModel,
			availableCommands: projectedCapabilities.availableCommands,
			configOptions: projectedCapabilities.configOptions,
		};

		this.hotStateStore.updateHotState(graph.canonicalSessionId, updates);
	}

	clearSessionProjection(sessionId: string): void {
		if (!this.hotStateStore.hasHotState(sessionId)) {
			return;
		}
		this.hotStateStore.updateHotState(sessionId, {
			activeTurnFailure: null,
			lastTerminalTurnId: null,
		});
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
		this.composerMachineService.removeMachine(sessionId);
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

	replaceSessionOpenSnapshot(snapshot: SessionOpenFound): void {
		const canonicalSessionId = snapshot.canonicalSessionId;
		const requestedSessionId = snapshot.requestedSessionId;
		const aliasSession =
			snapshot.isAlias && requestedSessionId !== canonicalSessionId
				? this.getSessionCold(requestedSessionId)
				: undefined;
		const canonicalSession = this.getSessionCold(canonicalSessionId);
		const preservedSession = canonicalSession ?? aliasSession;
		const now = new Date();
		const nextSessionLifecycleState =
			snapshot.sourcePath !== null
				? "persisted"
				: preservedSession?.sessionLifecycleState ?? "created";

		if (aliasSession && requestedSessionId !== canonicalSessionId) {
			this.removeSession(requestedSessionId);
		}

		if (canonicalSession) {
			this.updateSession(
				canonicalSessionId,
				{
					projectPath: snapshot.projectPath,
					agentId: normalizeCanonicalAgentId(snapshot.agentId),
					worktreePath: snapshot.worktreePath ?? undefined,
					title: snapshot.sessionTitle,
					sourcePath: snapshot.sourcePath ?? undefined,
					sessionLifecycleState: nextSessionLifecycleState,
				},
				{ touchUpdatedAt: false }
			);
		} else {
			this.addSession({
				id: canonicalSessionId,
				projectPath: snapshot.projectPath,
				agentId: normalizeCanonicalAgentId(snapshot.agentId),
				worktreePath: snapshot.worktreePath ?? undefined,
				title: snapshot.sessionTitle,
				updatedAt: preservedSession?.updatedAt ?? now,
				createdAt: preservedSession?.createdAt ?? now,
				sourcePath: snapshot.sourcePath ?? undefined,
				sessionLifecycleState: nextSessionLifecycleState,
				parentId: preservedSession?.parentId ?? null,
			});
		}

		this.entryStore.replaceTranscriptSnapshot(
			canonicalSessionId,
			snapshot.transcriptSnapshot,
			now
		);
		this.operationStore.replaceSessionOperations(canonicalSessionId, snapshot.operations);
		this.hotStateStore.initializeHotState(canonicalSessionId);
		this.hotStateStore.updateHotState(canonicalSessionId, {
			turnState: toFrontendTurnState(snapshot.turnState),
			activeTurnFailure: mapProjectionTurnFailure(snapshot.activeTurnFailure ?? null),
			lastTerminalTurnId: snapshot.lastTerminalTurnId ?? null,
			connectionError: null,
		});
		this.connectionService.sendContentLoad(canonicalSessionId);
		this.connectionService.sendContentLoaded(canonicalSessionId);
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
	 * Register a minimal cold-shell so that openPersistedSession can find session
	 * metadata when the session is only present in the backend registry (not yet in the
	 * local store). The canonical snapshot is applied by the subsequent
	 * openPersistedSession call; this method only seeds the lookup.
	 *
	 * No-op when the session is already registered.
	 */
	registerSessionPlaceholder(
		sessionId: string,
		projectPath: string,
		agentId: string,
		options?: {
			sourcePath?: string;
			worktreePath?: string;
			placeholderTitle?: string | null;
		}
	): void {
		if (this.getSessionCold(sessionId)) {
			return;
		}
		const now = new Date();
		this.addSession({
			id: sessionId,
			projectPath,
			agentId,
			worktreePath: options?.worktreePath,
			title: options?.placeholderTitle ?? null,
			updatedAt: now,
			createdAt: now,
			sourcePath: options?.sourcePath,
			sessionLifecycleState: options?.sourcePath ? "persisted" : "created",
			parentId: null,
		});
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
		launchToken?: string;
	}): ResultAsync<SessionCold, AppError> {
		return this.connectionMgr.createSession(options, this).andThen((createdSession) => {
			if (
				this.sessionOpenHydrator !== null &&
				createdSession.sessionOpen?.outcome === "found"
			) {
				return this.sessionOpenHydrator
					.hydrateCreated(createdSession.sessionOpen)
					.map(() => createdSession.session);
			}

			return okAsync(createdSession.session);
		});
	}

	setSessionOpenHydrator(hydrator: CreatedSessionHydrator): void {
		this.sessionOpenHydrator = hydrator;
	}

	setLiveSessionStateGraphConsumer(consumer: LiveSessionStateGraphConsumer): void {
		this.liveSessionStateGraphConsumer = consumer;
	}

	/**
	 * Connect to a session (resume or create ACP connection).
	 */
	connectSession(
		sessionId: string,
		options?: { openToken?: string }
	): ResultAsync<SessionCold, AppError> {
		return this.connectionMgr.connectSession(sessionId, this, options);
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
		const hotState = this.hotStateStore.getHotState(sessionId);

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

		if (hotState.isConnected) {
			return send();
		}

		return this.connectSession(sessionId).andThen(() => send());
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
	handleStreamComplete(sessionId: string, turnId?: TurnCompleteUpdate["turn_id"]): void {
		this.messagingSvc.handleStreamComplete(sessionId, turnId);
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
	handleTurnError(sessionId: string, update: TurnErrorUpdate): void {
		this.messagingSvc.handleTurnError(sessionId, update);
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

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void {
		const commands = routeSessionStateEnvelope(
			sessionId,
			this.entryStore.getTranscriptRevision(sessionId),
			envelope
		);

		for (const command of commands) {
			if (command.kind === "replaceGraph") {
				const graph = command.graph;
				this.entryStore.replaceTranscriptSnapshot(sessionId, graph.transcriptSnapshot, new Date());
				this.operationStore.replaceSessionOperations(sessionId, graph.operations);
				this.liveSessionStateGraphConsumer?.replaceSessionStateGraph(graph);
				this.applySessionStateGraph(graph);
				continue;
			}

			if (command.kind === "applyLifecycle") {
				const hotState = this.getHotState(sessionId);
				this.hotStateStore.updateHotState(sessionId, {
					status: toSessionStatusFromGraphLifecycle(command.lifecycle),
					isConnected: command.lifecycle.status === "ready",
					acpSessionId:
						command.lifecycle.status === "ready" ? sessionId : hotState.acpSessionId,
					connectionError: connectionErrorFromGraphState(
						command.lifecycle,
						hotState.activeTurnFailure ?? null
					),
				});
				continue;
			}

			if (command.kind === "applyCapabilities") {
				const session = this.getSessionCold(sessionId);
				if (!session) {
					continue;
				}
				const projectedCapabilities = projectGraphCapabilities(
					session.agentId,
					command.capabilities
				);
				this.capabilitiesStore.updateCapabilities(sessionId, {
					availableModes: projectedCapabilities.availableModes,
					availableModels: projectedCapabilities.availableModels,
					availableCommands: projectedCapabilities.availableCommands,
					modelsDisplay: projectedCapabilities.modelsDisplay,
					providerMetadata: projectedCapabilities.providerMetadata,
				});
				this.hotStateStore.updateHotState(sessionId, {
					currentMode: projectedCapabilities.currentMode,
					currentModel: projectedCapabilities.currentModel,
					availableCommands: projectedCapabilities.availableCommands,
					configOptions: projectedCapabilities.configOptions,
				});
				continue;
			}

			if (command.kind === "refreshSnapshot") {
				logger.warn("Refreshing session-state snapshot for transcript frontier mismatch", {
					sessionId,
					currentRevision: this.entryStore.getTranscriptRevision(sessionId),
					fromRevision: command.fromRevision,
					toRevision: command.toRevision,
				});
				void this.refreshSessionStateSnapshot(sessionId).match(
					() => undefined,
					() => undefined
				);
				continue;
			}

			this.applyTranscriptDelta(sessionId, command.delta);
		}
	}

	applyTranscriptDelta(sessionId: string, delta: TranscriptDelta): void {
		this.entryStore.applyTranscriptDelta(sessionId, delta, new Date());
	}

	private refreshSessionStateSnapshot(sessionId: string): InflightSessionStateRefresh {
		const existing = this.inflightSessionStateRefreshes.get(sessionId);
		if (existing) {
			return existing;
		}

		const refresh = api.getSessionState(sessionId).andThen((envelope) => {
			if (envelope.payload.kind !== "snapshot") {
				return errAsync(new SessionNotFoundError(sessionId));
			}

			this.applySessionStateEnvelope(sessionId, envelope);
			return okAsync(undefined);
		});

		this.inflightSessionStateRefreshes.set(sessionId, refresh);
		void refresh.match(
			() => {
				this.inflightSessionStateRefreshes.delete(sessionId);
			},
			(error) => {
				this.inflightSessionStateRefreshes.delete(sessionId);
				logger.error("Failed to refresh session-state snapshot", {
					sessionId,
					error,
				});
			}
		);
		return refresh;
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
