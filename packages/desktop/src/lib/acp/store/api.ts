/**
 * API boundary layer for the unified store.
 *
 * This module uses the type-safe Tauri command client for all store operations.
 * All commands are type-checked at compile time.
 */

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
import { tauriClient } from "../../utils/tauri-client";
import type { AppError } from "../errors/app-error";
import type { InteractionReplyRequest } from "../types/interaction-reply-request.js";
import type {
	AgentAvailabilityKind,
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
	return tauriClient.acp.initialize().pipe(Effect.map(() => undefined));
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
	return tauriClient.acp.resumeSession(sessionId, cwd, attemptId, agentId, launchModeId, openToken);
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
	return tauriClient.acp.newSession(cwd, agentId, launchToken, initialModelId, initialModeId);
}

/**
 * Send a prompt to the ACP agent (fire-and-forget).
 *
 * Returns immediately after sending the prompt. The response will arrive
 * via session/update notifications emitted as Tauri events.
 */
export function sendPrompt(
	sessionId: string,
	content: ReadonlyArray<Record<string, unknown> & { type: string }>,
	attemptId?: string
): Effect.Effect<void, AppError> {
	return tauriClient.acp.sendPrompt(sessionId, content, attemptId);
}

/**
 * Set the model for a session.
 */
export function setModel(sessionId: string, modelId: string): Effect.Effect<void, AppError> {
	return tauriClient.acp.setModel(sessionId, modelId);
}

/**
 * Set the mode for a session.
 */
export function setMode(sessionId: string, modeId: string): Effect.Effect<void, AppError> {
	return tauriClient.acp.setMode(sessionId, modeId);
}

/**
 * Set the autonomous policy for a session.
 */
export function setSessionAutonomous(
	sessionId: string,
	enabled: boolean
): Effect.Effect<void, AppError> {
	return tauriClient.acp.setSessionAutonomous(sessionId, enabled);
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
	return tauriClient.acp.setConfigOption(sessionId, configId, value) as Effect.Effect<
		SetConfigOptionResponse,
		AppError
	>;
}

/**
 * Cancel/stop streaming for a session.
 */
export function stopStreaming(sessionId: string): Effect.Effect<void, AppError> {
	return tauriClient.acp.cancel(sessionId);
}

/**
 * Reply to a canonical interaction through one backend-owned command path.
 */
export function replyInteraction(request: InteractionReplyRequest): Effect.Effect<void, AppError> {
	return tauriClient.acp.replyInteraction(request);
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
	return tauriClient.acp.respondInboundRequest(sessionId, requestId, result);
}

/**
 * Close a session and clean up its subprocess.
 * This kills the ACP subprocess associated with the session.
 */
export function closeSession(sessionId: string): Effect.Effect<void, AppError> {
	return tauriClient.acp.closeSession(sessionId);
}

export function fetchCanonicalSessionStateEnvelope(
	sessionId: string
): Effect.Effect<SessionStateEnvelope, AppError> {
	return tauriClient.acp.getSessionState(sessionId);
}

export interface SessionConnectionReadiness {
	readonly graphRevision: number;
	readonly lifecycle: SessionGraphLifecycle;
	readonly capabilities: SessionGraphCapabilities;
}

export function fetchSessionConnectionReadiness(
	sessionId: string
): Effect.Effect<SessionConnectionReadiness, AppError> {
	return tauriClient.acp.getSessionConnectionReadiness(sessionId);
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
	return tauriClient.history.scanProjectSessions(projectPaths);
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
	return tauriClient.history.getStartupSessions(sessionIds);
}

export function getSessionOpenResult(
	sessionId: string,
	projectPath: string,
	agentId: string,
	sourcePath?: string,
	repairPriority: "selected" | "visible" | "backfill" = "selected"
): Effect.Effect<SessionOpenResult, AppError> {
	return tauriClient.history.getSessionOpenResult(
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
	return tauriClient.history.awaitSessionOpenRepair(repairTicket);
}

export function setSessionTitle(sessionId: string, title: string): Effect.Effect<void, AppError> {
	return tauriClient.history.setSessionTitle(sessionId, title);
}

// ============================================
// WORKSPACE PERSISTENCE API
// ============================================

/**
 * Save workspace state to database.
 * Returns Effect.Effect for proper error handling.
 */
export function saveWorkspaceState(state: PersistedWorkspaceState): Effect.Effect<void, AppError> {
	return tauriClient.workspace.saveWorkspaceState(state);
}

/**
 * Load workspace state from database.
 */
export function loadWorkspaceState(): Effect.Effect<PersistedWorkspaceRestoreState | null, AppError> {
	return tauriClient.workspace.loadWorkspaceState();
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
}

/**
 * List available agents.
 */
export function listAgents(): Effect.Effect<AgentInfo[], AppError> {
	return tauriClient.acp.listAgents();
}

/**
 * Install an automatically provisioned agent.
 */
export function installAgent(agentId: string): Effect.Effect<void, AppError> {
	return tauriClient.acp.installAgent(agentId);
}

/**
 * Uninstall a previously downloaded agent.
 */
export function uninstallAgent(agentId: string): Effect.Effect<void, AppError> {
	return tauriClient.acp.uninstallAgent(agentId);
}

/**
 * Initialize ACP service.
 */
export function initializeAcp(): Effect.Effect<void, AppError> {
	return tauriClient.acp.initialize().pipe(Effect.map(() => undefined));
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
	getStartupSessions,
	getSessionOpenResult,
	awaitSessionOpenRepair,
	setSessionTitle,

	// Workspace
	saveWorkspaceState,
	loadWorkspaceState,

	// Agent Management
	listAgents,
	installAgent,
	uninstallAgent,
};
