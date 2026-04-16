/**
 * API boundary layer for the unified store.
 *
 * This module uses the type-safe Tauri command client for all store operations.
 * All commands are type-checked at compile time.
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type {
	ProviderMetadataProjection,
	SessionOpenResult,
	SessionProjectionSnapshot,
} from "../../services/acp-types.js";
import type { HistoryEntry, StartupSessionsResponse } from "../../services/claude-history-types";
import type { ConfigOptionData, ConvertedSession } from "../../services/converted-session-types.js";
import { tauriClient } from "../../utils/tauri-client";
import { AgentError, type AppError } from "../errors/app-error";
import type { InteractionReplyRequest } from "../types/interaction-reply-request.js";
import type { AgentAvailabilityKind, PersistedWorkspaceState, ResumeSessionResult } from "./types";

// ============================================
// ACP AGENT API
// ============================================

/**
 * Initialize the ACP agent service.
 */
export function initialize(): ResultAsync<void, AppError> {
	return tauriClient.acp.initialize().map(() => undefined);
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
): ResultAsync<void, AppError> {
	return tauriClient.acp.resumeSession(
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
	launchToken?: string
): ResultAsync<ResumeSessionResult, AppError> {
	return tauriClient.acp.newSession(cwd, agentId, launchToken);
}

/**
 * Send a prompt to the ACP agent (fire-and-forget).
 *
 * Returns immediately after sending the prompt. The response will arrive
 * via session/update notifications emitted as Tauri events.
 */
export function sendPrompt(
	sessionId: string,
	content: ReadonlyArray<Record<string, unknown> & { type: string }>
): ResultAsync<void, AppError> {
	return tauriClient.acp.sendPrompt(sessionId, content);
}

/**
 * Set the model for a session.
 */
export function setModel(sessionId: string, modelId: string): ResultAsync<void, AppError> {
	return tauriClient.acp.setModel(sessionId, modelId);
}

/**
 * Set the mode for a session.
 */
export function setMode(sessionId: string, modeId: string): ResultAsync<void, AppError> {
	return tauriClient.acp.setMode(sessionId, modeId);
}

/**
 * Set the autonomous policy for a session.
 */
export function setSessionAutonomous(
	sessionId: string,
	enabled: boolean
): ResultAsync<void, AppError> {
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
): ResultAsync<SetConfigOptionResponse, AppError> {
	return tauriClient.acp.setConfigOption(sessionId, configId, value) as ResultAsync<
		SetConfigOptionResponse,
		AppError
	>;
}

/**
 * Cancel/stop streaming for a session.
 */
export function stopStreaming(sessionId: string): ResultAsync<void, AppError> {
	return tauriClient.acp.cancel(sessionId);
}

/**
 * Reply to a permission request.
 */
export function replyPermission(
	sessionId: string,
	permissionId: string,
	reply: "once" | "always" | "reject"
): ResultAsync<void, AppError> {
	return tauriClient.acp.replyPermission(sessionId, permissionId, reply);
}

/**
 * Reply to a question request.
 */
export function replyQuestion(
	sessionId: string,
	questionId: string,
	answers: unknown
): ResultAsync<void, AppError> {
	return tauriClient.acp.replyQuestion(sessionId, questionId, answers);
}

/**
 * Reply to a canonical interaction through one backend-owned command path.
 */
export function replyInteraction(request: InteractionReplyRequest): ResultAsync<void, AppError> {
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
): ResultAsync<void, AppError> {
	return tauriClient.acp.respondInboundRequest(sessionId, requestId, result);
}

/**
 * Close a session and clean up its subprocess.
 * This kills the ACP subprocess associated with the session.
 */
export function closeSession(sessionId: string): ResultAsync<void, AppError> {
	return tauriClient.acp.closeSession(sessionId);
}

export function getSessionProjection(
	sessionId: string
): ResultAsync<SessionProjectionSnapshot, AppError> {
	return tauriClient.acp.getSessionProjection(sessionId);
}

// ============================================
// HISTORY API
// ============================================

/**
 * Get session history entries from ALL agents by scanning project directories.
 *
 * @param projectPaths - Array of project paths to scan for sessions.
 */
export function scanSessions(projectPaths: string[]): ResultAsync<HistoryEntry[], AppError> {
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
): ResultAsync<StartupSessionsResponse, AppError> {
	return tauriClient.history.getStartupSessions(sessionIds);
}

/**
 * Get a session with full entries from any agent.
 * Routes to agent-specific parsers that read from source files.
 *
 * @param sessionId - The session ID to load
 * @param projectPath - The project path for this session
 * @param agentId - The agent ID ("claude-code", "cursor", "opencode")
 * @param sourcePath - Optional source file path for direct O(1) retrieval (Cursor sessions)
 * @returns ResultAsync containing ConvertedSession (unified format)
 */
export function getSession(
	sessionId: string,
	projectPath: string,
	agentId: string,
	sourcePath?: string
): ResultAsync<ConvertedSession, AppError> {
	return tauriClient.history
		.getUnifiedSession(sessionId, projectPath, agentId, sourcePath)
		.andThen((session) => {
			if (session !== null) {
				return okAsync(session);
			}
			return errAsync(new AgentError("get_session", new Error(`Session ${sessionId} not found`)));
	});
}

export function getSessionOpenResult(
	sessionId: string,
	projectPath: string,
	agentId: string,
	sourcePath?: string
): ResultAsync<SessionOpenResult, AppError> {
	return tauriClient.history.getSessionOpenResult(sessionId, projectPath, agentId, sourcePath);
}

/**
 * @deprecated Use getSession() instead
 * Get a converted session with full entries.
 */
export function getConvertedSession(
	sessionId: string,
	projectPath: string
): ResultAsync<ConvertedSession, AppError> {
	return getSession(sessionId, projectPath, "claude-code");
}

export function setSessionTitle(sessionId: string, title: string): ResultAsync<void, AppError> {
	return tauriClient.history.setSessionTitle(sessionId, title);
}

// ============================================
// WORKSPACE PERSISTENCE API
// ============================================

/**
 * Save workspace state to database.
 * Returns ResultAsync for proper error handling.
 */
export function saveWorkspaceState(state: PersistedWorkspaceState): ResultAsync<void, AppError> {
	return tauriClient.workspace.saveWorkspaceState(state);
}

/**
 * Load workspace state from database.
 */
export function loadWorkspaceState(): ResultAsync<PersistedWorkspaceState | null, AppError> {
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
	autonomous_supported_mode_ids?: ReadonlyArray<string>;
	default_selection_rank?: number;
	provider_metadata?: ProviderMetadataProjection;
}

/**
 * List available agents.
 */
export function listAgents(): ResultAsync<AgentInfo[], AppError> {
	return tauriClient.acp.listAgents();
}

/**
 * Install an automatically provisioned agent.
 */
export function installAgent(agentId: string): ResultAsync<void, AppError> {
	return tauriClient.acp.installAgent(agentId);
}

/**
 * Uninstall a previously downloaded agent.
 */
export function uninstallAgent(agentId: string): ResultAsync<void, AppError> {
	return tauriClient.acp.uninstallAgent(agentId);
}

/**
 * Initialize ACP service.
 */
export function initializeAcp(): ResultAsync<void, AppError> {
	return tauriClient.acp.initialize().map(() => undefined);
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
	getSessionProjection,
	replyInteraction,
	replyPermission,
	replyQuestion,
	respondInboundRequest,

	// History
	scanSessions,
	getStartupSessions,
	getSession,
	getSessionOpenResult,
	getConvertedSession,
	setSessionTitle,

	// Workspace
	saveWorkspaceState,
	loadWorkspaceState,

	// Agent Management
	listAgents,
	installAgent,
	uninstallAgent,
};
