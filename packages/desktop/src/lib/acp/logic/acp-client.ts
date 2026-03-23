import { okAsync, ResultAsync } from "neverthrow";
import type { ContentBlock } from "../../services/converted-session-types.js";
import { tauriClient } from "../../utils/tauri-client.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { AgentError } from "../errors/app-error.js";
import { type AcpError, ConnectionError, tryDeserializeAcpError } from "../errors/index.js";
import type { InitializeResponse } from "../types/initialize-response.js";
import type { ModeId } from "../types/mode-id.js";
import type { ModelId } from "../types/model-id.js";
import type { NewSessionResponse } from "../types/new-session-response.js";
import type { ResumeSessionResponse } from "../types/resume-session-response.js";
import type { SessionId } from "../types/session-id.js";
import type { SessionResponse } from "../types/session-response.js";
import { createLogger } from "../utils/logger.js";

/**
 * ACP Client for communicating with the ACP agent via Tauri backend.
 *
 * This client provides a type-safe, error-handled interface to all
 * ACP protocol methods using neverthrow Result types.
 *
 * All methods return ResultAsync to enable proper error handling
 * and composability with neverthrow.
 *
 * @example
 * ```typescript
 * const client = new AcpClient();
 *
 * const result = await client.initialize();
 * result
 *   .map(response => console.log('Initialized:', response))
 *   .mapErr(error => console.error('Error:', error));
 * ```
 */
export class AcpClient {
	private readonly logger = createLogger({
		id: LOGGER_IDS.ACP_CLIENT,
		name: "ACP Client",
	});

	private _initialized = false;
	private _initializePromise: Promise<void> | null = null;

	/**
	 * Helper function to deserialize Tauri errors.
	 * Handles both structured SerializableAcpError (validated via Zod) and legacy string errors.
	 */
	private deserializeTauriError(error: unknown, context: string): AcpError {
		// Extract raw error from AgentError wrapper for deserialization
		const raw = error instanceof AgentError ? error.cause : error;
		const acpError = tryDeserializeAcpError(raw);
		if (acpError !== null) {
			return acpError;
		}
		this.logger.error(`${context} error:`, error);
		return new ConnectionError(`${context}: ${error}`, error as Error);
	}

	/**
	 * Whether the client has been successfully initialized.
	 */
	get isInitialized(): boolean {
		return this._initialized;
	}

	/**
	 * Initializes the ACP connection.
	 *
	 * This must be called before any other operations.
	 * Safe to call multiple times - subsequent calls are no-ops.
	 *
	 * @returns ResultAsync containing the initialize response or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#initialize
	 */
	initialize(): ResultAsync<InitializeResponse, AcpError> {
		// Already initialized - return cached success
		if (this._initialized) {
			this.logger.debug("initialize() - already initialized, skipping");
			return okAsync({
				protocolVersion: 1,
				agentCapabilities: {},
				agentInfo: {},
				authMethods: [],
			} satisfies InitializeResponse);
		}

		this.logger.debug("initialize() called");
		return tauriClient.acp
			.initialize()
			.mapErr((error) => this.deserializeTauriError(error, "Failed to initialize ACP connection"))
			.map((response) => {
				this._initialized = true;
				this.logger.debug("Initialize successful:", response);
				return response as InitializeResponse;
			})
			.mapErr((error) => {
				this.logger.error("Initialize failed:", error);
				return error as AcpError;
			});
	}

	/**
	 * Ensures the client is initialized before performing operations.
	 * Uses a cached promise to prevent duplicate initialization calls.
	 *
	 * @returns ResultAsync that resolves when initialized
	 */
	ensureInitialized(): ResultAsync<void, AcpError> {
		if (this._initialized) {
			return okAsync(undefined);
		}

		// Deduplicate concurrent initialization calls
		if (!this._initializePromise) {
			this._initializePromise = new Promise((resolve, reject) => {
				this.initialize().match(
					() => resolve(),
					(err) => reject(err)
				);
			});
		}

		return ResultAsync.fromPromise(this._initializePromise, (error) =>
			this.deserializeTauriError(error, "Initialize promise failed")
		);
	}

	/**
	 * Creates a new ACP session.
	 *
	 * @param cwd - Current working directory for the session
	 * @param agentId - Optional agent ID to use for the session
	 * @returns ResultAsync containing the new session response or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessionnew
	 */
	newSession(cwd: string, agentId?: string): ResultAsync<NewSessionResponse, AcpError> {
		this.logger.debug("newSession() called with cwd:", cwd, "agentId:", agentId);
		return tauriClient.acp
			.newSession(cwd, agentId)
			.mapErr((error) => this.deserializeTauriError(error, "Failed to create new session"))
			.map((response) => {
				this.logger.debug("New session created:", {
					sessionId: (response as NewSessionResponse).sessionId,
					modesCount: (response as NewSessionResponse).modes.availableModes.length,
					currentMode: (response as NewSessionResponse).modes.currentModeId,
				});
				return response as NewSessionResponse;
			})
			.mapErr((error) => {
				this.logger.error("New session failed:", error);
				return error as AcpError;
			});
	}

	/**
	 * Resumes an existing ACP session.
	 *
	 * @param sessionId - The session ID to resume
	 * @param cwd - Current working directory for the session
	 * @param agentId - Optional agent ID to use for the session
	 * @returns ResultAsync containing the resume session response or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#unstable-sessionresume
	 */
	resumeSession(
		sessionId: SessionId,
		cwd: string,
		agentId?: string
	): ResultAsync<ResumeSessionResponse, AcpError> {
		this.logger.debug(
			"resumeSession() called with sessionId:",
			sessionId,
			"cwd:",
			cwd,
			"agentId:",
			agentId
		);
		return tauriClient.acp
			.resumeSession(sessionId, cwd, agentId)
			.mapErr((error) => this.deserializeTauriError(error, "Failed to resume session"))
			.map((response) => {
				// Per ACP protocol: ResumeSessionResponse does NOT include sessionId
				this.logger.debug("Session resumed:", {
					sessionId,
					modesCount: (response as ResumeSessionResponse).modes.availableModes.length,
					currentMode: (response as ResumeSessionResponse).modes.currentModeId,
				});
				return response as ResumeSessionResponse;
			})
			.mapErr((error) => {
				this.logger.error("Resume session failed:", error);
				return error as AcpError;
			});
	}

	/**
	 * Creates a new session and returns a discriminated union response.
	 * This is the type-safe alternative to newSession() that eliminates unsafe type assertions.
	 *
	 * @param cwd - Current working directory for the session
	 * @param agentId - Optional agent ID to use for the session
	 * @returns ResultAsync containing the discriminated union session response or an error
	 */
	createSession(cwd: string, agentId?: string): ResultAsync<SessionResponse, AcpError> {
		return this.newSession(cwd, agentId)
			.map((response) => ({
				type: "new" as const,
				sessionId: response.sessionId,
				models: response.models,
				modes: response.modes,
			}))
			.mapErr((error) => error);
	}

	/**
	 * Resumes an existing session and returns a discriminated union response.
	 * This is the type-safe alternative to resumeSession() that eliminates unsafe type assertions.
	 *
	 * @param sessionId - The session ID to resume
	 * @param cwd - Current working directory for the session
	 * @param agentId - Optional agent ID to use for the session
	 * @returns ResultAsync containing the discriminated union session response or an error
	 */
	resumeSessionSafe(
		sessionId: SessionId,
		cwd: string,
		agentId?: string
	): ResultAsync<SessionResponse, AcpError> {
		return this.resumeSession(sessionId, cwd, agentId)
			.map((response) => ({
				type: "resume" as const,
				models: response.models,
				modes: response.modes,
			}))
			.mapErr((error) => error);
	}

	/**
	 * Sets the model for a session.
	 *
	 * @param sessionId - The session ID
	 * @param modelId - The model ID to set
	 * @returns ResultAsync containing void on success or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessionsetmodel
	 */
	setModel(sessionId: SessionId, modelId: ModelId): ResultAsync<void, AcpError> {
		return tauriClient.acp
			.setModel(sessionId, modelId)
			.mapErr((error) => this.deserializeTauriError(error, "Failed to set model"));
	}

	/**
	 * Sets the mode for a session.
	 *
	 * @param sessionId - The session ID
	 * @param modeId - The mode ID to set
	 * @returns ResultAsync containing void on success or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessionsetmode
	 */
	setMode(sessionId: SessionId, modeId: ModeId): ResultAsync<void, AcpError> {
		return tauriClient.acp
			.setMode(sessionId, modeId)
			.mapErr((error) => this.deserializeTauriError(error, "Failed to set mode"));
	}

	/**
	 * Sends a prompt to a session (fire-and-forget).
	 *
	 * This method returns immediately after the prompt is sent to the subprocess.
	 * The actual response will arrive via session/update notifications which are
	 * emitted as Tauri events (`acp-session-update`).
	 *
	 * @param sessionId - The session ID
	 * @param content - Array of content blocks to send
	 * @returns ResultAsync containing void on success or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#prompt
	 */
	sendPrompt(sessionId: SessionId, content: ContentBlock[]): ResultAsync<void, AcpError> {
		return tauriClient.acp
			.sendPrompt(sessionId, content)
			.mapErr((error) => this.deserializeTauriError(error, "Failed to send prompt"));
	}

	/**
	 * Cancels a session.
	 *
	 * @param sessionId - The session ID to cancel
	 * @returns ResultAsync containing void on success or an error
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessioncancel
	 */
	cancel(sessionId: SessionId): ResultAsync<void, AcpError> {
		return tauriClient.acp
			.cancel(sessionId)
			.mapErr((error) => this.deserializeTauriError(error, "Failed to cancel session"));
	}
}
