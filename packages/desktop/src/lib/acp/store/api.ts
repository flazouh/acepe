/**
 * API boundary layer for the unified store.
 *
 * This module uses the type-safe backend command client for all store operations.
 * All commands are type-checked at compile time.
 */

import type {
	RpcProjectedProject,
	RpcProjectedSession,
	RpcSessionSnapshot,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import type {
	ProviderMetadataProjection,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionOpenResult,
	SessionStateEnvelope,
} from "../../services/acp-types.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types";
import type { ConfigOptionData } from "../../services/converted-session-types.js";
import { backendClient } from "../../utils/backend-client";
import { ensureProviderSessionImported as backendClientEnsureProviderSessionImported } from "../../utils/backend-client/history.js";
import type { AppError } from "../errors/app-error";
import type { InteractionReplyRequest } from "../types/interaction-reply-request.js";
import type {
	AgentAvailabilityKind,
	AgentSignInMethod,
	PersistedWorkspaceRestoreState,
	PersistedWorkspaceState,
	ResumeSessionResult,
} from "./types";

// ============================================
// ACP AGENT API
// ============================================

/**
 * Initialize the ACP agent service.
 */
export function initialize(): Effect.Effect<void, AppError> {
	return backendClient.acp.initialize().pipe(Effect.map(() => undefined));
}

/**
 * Resume an existing session using backend-owned descriptor resolution.
 * Fire-and-forget: returns immediately after validation. Completion/failure
 * arrives via connectionComplete/connectionFailed events through the SSE bridge.
 */
export function resumeSession(
	sessionId: string,
	cwd: string,
	attemptId: number,
	agentId?: string,
	launchModeId?: string,
	openToken?: string
): Effect.Effect<void, AppError> {
	return backendClient.acp.resumeSession(
		sessionId,
		cwd,
		attemptId,
		agentId,
		launchModeId,
		openToken
	);
}

/**
 * Create a new session with the ACP agent.
 */
export function newSession(
	cwd: string,
	agentId?: string,
	launchToken?: string,
	initialModelId?: string,
	initialModeId?: string
): Effect.Effect<ResumeSessionResult, AppError> {
	return backendClient.acp.newSession(cwd, agentId, launchToken, initialModelId, initialModeId);
}

/**
 * Send a prompt to the ACP agent (fire-and-forget).
 *
 * Returns immediately after sending the prompt. The response will arrive
 * via session/update notifications emitted on the backend event stream.
 */
export function sendPrompt(
	sessionId: string,
	content: ReadonlyArray<Record<string, unknown> & { type: string }>,
	attemptId?: string
): Effect.Effect<void, AppError> {
	return backendClient.acp.sendPrompt(sessionId, content, attemptId);
}

/**
 * Set the model for a session.
 */
export function setModel(sessionId: string, modelId: string): Effect.Effect<void, AppError> {
	return backendClient.acp.setModel(sessionId, modelId);
}

/**
 * Set the mode for a session.
 */
export function setMode(sessionId: string, modeId: string): Effect.Effect<void, AppError> {
	return backendClient.acp.setMode(sessionId, modeId);
}

/**
 * Set the autonomous policy for a session.
 */
export function setSessionAutonomous(
	sessionId: string,
	enabled: boolean
): Effect.Effect<void, AppError> {
	return backendClient.acp.setSessionAutonomous(sessionId, enabled);
}

/** Response shape from session/set_config_option — returns full updated config state. */
export interface SetConfigOptionResponse {
	configOptions?: ConfigOptionData[];
}

/**
 * Set a configuration option for a session.
 * Returns the full updated config options from the agent.
 */
export function setConfigOption(
	sessionId: string,
	configId: string,
	value: string
): Effect.Effect<SetConfigOptionResponse, AppError> {
	return backendClient.acp.setConfigOption(sessionId, configId, value) as Effect.Effect<
		SetConfigOptionResponse,
		AppError
	>;
}

/**
 * Cancel/stop streaming for a session.
 */
export function stopStreaming(sessionId: string): Effect.Effect<void, AppError> {
	return backendClient.acp.cancel(sessionId);
}

/**
 * Reply to a canonical interaction through one backend-owned command path.
 */
export function replyInteraction(request: InteractionReplyRequest): Effect.Effect<void, AppError> {
	return backendClient.acp.replyInteraction(request);
}

/**
 * Respond to an inbound JSON-RPC request from the ACP subprocess.
 * Used to respond to requests like client/requestPermission.
 */
export function respondInboundRequest(
	sessionId: string,
	requestId: number,
	result: unknown
): Effect.Effect<void, AppError> {
	return backendClient.acp.respondInboundRequest(sessionId, requestId, result);
}

/**
 * Close a session and clean up its subprocess.
 * This kills the ACP subprocess associated with the session.
 */
export function closeSession(sessionId: string): Effect.Effect<void, AppError> {
	return backendClient.acp.closeSession(sessionId);
}

export function fetchCanonicalSessionStateEnvelope(
	sessionId: string
): Effect.Effect<SessionStateEnvelope, AppError> {
	return backendClient.acp.getSessionState(sessionId);
}

export interface SessionConnectionReadiness {
	readonly graphRevision: number;
	readonly lifecycle: SessionGraphLifecycle;
	readonly capabilities: SessionGraphCapabilities;
}

export function fetchSessionConnectionReadiness(
	sessionId: string
): Effect.Effect<SessionConnectionReadiness, AppError> {
	return backendClient.acp.getSessionConnectionReadiness(sessionId);
}

// ============================================
// HISTORY API
// ============================================

/**
 * Get session history entries from ALL agents by scanning project directories.
 *
 * @param projectPaths - Array of project paths to scan for sessions.
 */
export function scanSessions(projectPaths: string[]): Effect.Effect<HistoryEntry[], AppError> {
	return backendClient.history.scanProjectSessions(projectPaths);
}

/**
 * Read the orchestration-projected session list (every project, every
 * session), independent of provider-owned on-disk history. Sessions
 * dispatched via session.create show up here immediately, even before a
 * provider adapter has written anything to disk -- unlike scanSessions,
 * which only ever finds sessions the provider has already persisted.
 */
export function getLibrarySessionsSnapshot(): Effect.Effect<
	{ sessions: readonly RpcProjectedSession[]; projects: readonly RpcProjectedProject[] },
	AppError
> {
	return backendClient.acp.getLibrarySessionsSnapshot();
}

/**
 * Load only the metadata for specific restored session IDs.
 * Used on startup to hydrate open panels without blocking on a full sidebar scan.
 *
 * Returns the hydrated entries plus a mapping from any requested alias IDs
 * (provider_session_id values) to their canonical Acepe session IDs.
 */
export function getStartupSessions(
	sessionIds: string[]
): Effect.Effect<StartupSessionsResponse, AppError> {
	return backendClient.history.getStartupSessions(sessionIds);
}

export function getSessionOpenResult(
	sessionId: string,
	projectPath: string,
	agentId: string,
	sourcePath?: string,
	repairPriority: "selected" | "visible" | "backfill" = "selected"
): Effect.Effect<SessionOpenResult, AppError> {
	return backendClient.history.getSessionOpenResult(
		sessionId,
		projectPath,
		agentId,
		sourcePath,
		repairPriority
	);
}

export function awaitSessionOpenRepair(
	repairTicket: string
): Effect.Effect<SessionOpenResult, AppError> {
	return backendClient.history.awaitSessionOpenRepair(repairTicket);
}

export function setSessionTitle(sessionId: string, title: string): Effect.Effect<void, AppError> {
	return backendClient.history.setSessionTitle(sessionId, title);
}

/**
 * The `{sessionId}` contract snapshot: `session` plus the full ordered
 * `messages`/`turns`/`activities`/`pendingApprovals`. Used to hydrate a
 * reopened session's canonical transcript (see reopen-snapshot-graph.ts and
 * reopened-session-hydrator.ts) -- `getSessionOpenResult` above is
 * unsupportedOnContract under Electrobun, so this is the real source of
 * historical transcript content for a session this app run did not itself
 * create.
 */
export function getSessionSnapshot(sessionId: string): Effect.Effect<RpcSessionSnapshot, AppError> {
	return backendClient.acp.getSessionSnapshot(sessionId);
}

/**
 * Idempotent best-effort import of a disk-discovered (~/.claude) session
 * into the orchestration event store, keyed by scanning discovered projects
 * for the session id -- reused as-is from history.ts's rename-triggers-import
 * path (setSessionTitle/setSessionPrNumber already call it before writing).
 * A no-op when the session is already imported.
 */
export function ensureProviderSessionImported(sessionId: string): Effect.Effect<void, AppError> {
	return backendClientEnsureProviderSessionImported(sessionId);
}

// ============================================
// WORKSPACE PERSISTENCE API
// ============================================

/**
 * Save workspace state to database.
 * Returns Effect.Effect for proper error handling.
 */
export function saveWorkspaceState(state: PersistedWorkspaceState): Effect.Effect<void, AppError> {
	return backendClient.workspace.saveWorkspaceState(state);
}

/**
 * Load workspace state from database.
 */
export function loadWorkspaceState(): Effect.Effect<
	PersistedWorkspaceRestoreState | null,
	AppError
> {
	return backendClient.workspace.loadWorkspaceState();
}

// ============================================
// AGENT MANAGEMENT API
// ============================================

export interface AgentInfo {
	id: string;
	name: string;
	description?: string;
	icon?: string;
	availability_kind?: AgentAvailabilityKind;
	default_selection_rank?: number;
	provider_metadata?: ProviderMetadataProjection;
	supports_project_discovery?: boolean;
	sign_in: AgentSignInMethod;
}

/**
 * List available agents.
 */
export function listAgents(): Effect.Effect<AgentInfo[], AppError> {
	return backendClient.acp.listAgents();
}

/**
 * Install an automatically provisioned agent. Answers with the version now on
 * disk and the agent list the backend read back after installing, so no
 * caller has to keep its own idea of which agents are installed.
 */
export function installAgent(
	agentId: string
): Effect.Effect<{ readonly version: string; readonly agents: AgentInfo[] }, AppError> {
	return backendClient.acp.installAgent(agentId);
}

/**
 * Uninstall a previously downloaded agent. Answers with the same re-read
 * agent list installAgent does.
 */
export function uninstallAgent(agentId: string): Effect.Effect<AgentInfo[], AppError> {
	return backendClient.acp.uninstallAgent(agentId);
}

/**
 * Run the agent's own sign-in on the backend and wait for it. Long-running:
 * it is waiting on a browser step. Answers with the agent list re-read on the
 * backend after the login command exited, the same way installAgent does.
 */
export function authenticateAgent(agentId: string): Effect.Effect<AgentInfo[], AppError> {
	return backendClient.acp.authenticateAgent(agentId);
}

/** Stop a sign-in that is running. `false` means there was none. */
export function cancelAgentAuthentication(agentId: string): Effect.Effect<boolean, AppError> {
	return backendClient.acp.cancelAgentAuthentication(agentId);
}

/**
 * Initialize ACP service.
 */
export function initializeAcp(): Effect.Effect<void, AppError> {
	return backendClient.acp.initialize().pipe(Effect.map(() => undefined));
}

// ============================================
// NAMESPACE EXPORT FOR CONVENIENCE
// ============================================

export const api = {
	// ACP Agent
	initialize,
	initializeAcp,
	newSession,
	resumeSession,
	sendPrompt,
	setModel,
	setMode,
	setSessionAutonomous,
	setConfigOption,
	stopStreaming,
	closeSession,
	fetchCanonicalSessionStateEnvelope,
	fetchSessionConnectionReadiness,
	replyInteraction,
	respondInboundRequest,

	// History
	scanSessions,
	getLibrarySessionsSnapshot,
	getStartupSessions,
	getSessionOpenResult,
	awaitSessionOpenRepair,
	setSessionTitle,
	getSessionSnapshot,
	ensureProviderSessionImported,

	// Workspace
	saveWorkspaceState,
	loadWorkspaceState,

	// Agent Management
	listAgents,
	installAgent,
	uninstallAgent,
	authenticateAgent,
	cancelAgentAuthentication,
};
