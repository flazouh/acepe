/**
 * Session Handler - Manages session operations.
 *
 * Handles selecting sessions, creating sessions, loading historical sessions,
 * and connection orchestration for opened sessions.
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { SessionListItem } from "$lib/acp/components/session-list/session-list-types.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionProjectionHydrator } from "$lib/acp/store/services/session-projection-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import {
	type MainAppViewError,
	SessionCreationError,
	SessionSelectionError,
} from "../../errors/main-app-view-error.js";
import type { CreateSessionOptions } from "../../types/create-session-options.js";
import type { MainAppViewState } from "../main-app-view-state.svelte.js";
import { preloadAndConnectSession } from "../session-preload-connect.js";

const PRELOAD_TIMEOUT_MS = 30_000;

/**
 * Handles session operations.
 */
export class SessionHandler {
	/**
	 * Creates a new session handler.
	 *
	 * @param state - The main app view state
	 * @param sessionStore - The session store
	 * @param panelStore - The panel store
	 */
	constructor(
		private readonly state: MainAppViewState,
		private readonly sessionStore: SessionStore,
		private readonly panelStore: PanelStore,
		private readonly projectionHydrator: Pick<SessionProjectionHydrator, "hydrateSession" | "clearSession">
	) {}

	/**
	 * Selects and opens a session.
	 *
	 * @param sessionId - The session ID to select
	 * @param sessionInfo - Optional session info for loading historical sessions
	 * @returns ResultAsync indicating success or error
	 */
	selectSession(
		sessionId: string,
		sessionInfo?: SessionListItem
	): ResultAsync<void, MainAppViewError> {
		// Check if session exists in memory
		const existingSession = this.sessionStore.sessions.find((s) => s.id === sessionId);
		let finalSessionId = sessionId;

		// If session not in memory, try to load it
		if (!existingSession && sessionInfo) {
			return this.sessionStore
				.loadHistoricalSession(
					sessionInfo.id,
					sessionInfo.projectPath,
					sessionInfo.title,
					sessionInfo.agentId,
					sessionInfo.sourcePath,
					sessionInfo.sequenceId,
					sessionInfo.worktreePath
				)
				.mapErr(
					(error) =>
						new SessionSelectionError(
							sessionId,
							"Failed to load historical session",
							error instanceof Error ? error : undefined
						)
				)
				.andThen((loadedSession) => {
					finalSessionId = loadedSession.id;
					return this.preloadAndOpenSession(finalSessionId);
				});
		} else if (existingSession) {
			finalSessionId = existingSession.id;
			return this.preloadAndOpenSession(finalSessionId);
		} else {
			return errAsync(
				new SessionSelectionError(sessionId, "Session not found and no sessionInfo provided")
			);
		}
	}

	/**
	 * Preloads session details and opens the session.
	 *
	 * Opens the panel immediately for zero-latency UI response, then loads
	 * session content asynchronously in the background.
	 *
	 * @param sessionId - The session ID
	 * @returns ResultAsync indicating success or error
	 */
	private preloadAndOpenSession(sessionId: string): ResultAsync<void, MainAppViewError> {
		const session = this.sessionStore.sessions.find((s) => s.id === sessionId);

		// Check if session details are already cached
		const cachedDetails = this.sessionStore.getSessionDetail(sessionId);

		// Open panel IMMEDIATELY for zero-latency response
		this.panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);

		if (!cachedDetails) {
			preloadAndConnectSession({
				sessionId,
				sessionStore: this.sessionStore,
				projectionHydrator: this.projectionHydrator,
				panelStore: this.panelStore,
				timeoutMs: PRELOAD_TIMEOUT_MS,
				source: "session-handler",
			});

			// Return immediately - don't wait for preload
			return okAsync(undefined);
		}

		// Already cached - connect immediately.
		if (session) {
			this.sessionStore.connectSession(sessionId).mapErr(() => {
				// Error state will be shown via status indicator.
			});
		}

		return okAsync(undefined);
	}

	/**
	 * Creates a new session.
	 *
	 * @param options - Session creation options
	 * @returns ResultAsync containing the created session ID or error
	 */
	createSession(options: CreateSessionOptions): ResultAsync<string, MainAppViewError> {
		return this.sessionStore
			.createSession({
				agentId: options.agentId,
				projectPath: options.projectPath,
			})
			.map((session) => {
				this.panelStore.openSession(session.id, DEFAULT_PANEL_WIDTH);
				return session.id;
			})
			.mapErr(
				(error) =>
					new SessionCreationError(
						options.agentId,
						options.projectPath,
						error instanceof Error ? error : new Error(String(error))
					)
			);
	}

	/**
	 * Sets project context for a panel so the first user message can create the session.
	 *
	 * @param panelId - The panel ID
	 * @param project - The project to create session for
	 * @returns ResultAsync indicating success or error
	 */
	createSessionForProject(
		panelId: string,
		project: Pick<Project, "path" | "name">
	): ResultAsync<void, MainAppViewError> {
		const panel = this.panelStore.panels.find((p) => p.id === panelId && p.kind === "agent");
		if (!panel) {
			console.error("[session-handler] createSessionForProject ABORT — panel not found", {
				panelId,
			});
			return errAsync(
				new SessionCreationError("", project.path, new Error("Panel not found for project selection"))
			);
		}
		const selectedAgentId = panel.selectedAgentId;
		if (!selectedAgentId) {
			console.error("[session-handler] createSessionForProject ABORT — no agent selected", {
				panelId,
			});
			return errAsync(
				new SessionCreationError("", project.path, new Error("No agent selected for this panel"))
			);
		}

		// Set project path immediately to clear project selection UI
		this.panelStore.setPanelProjectPath(panelId, project.path);

		// Session creation is intentionally deferred until the first user message.
		// Selecting a project should only prepare the panel context.
		return okAsync(undefined);
	}
}
