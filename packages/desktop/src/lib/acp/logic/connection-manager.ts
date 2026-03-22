import { okAsync, ResultAsync } from "neverthrow";
import type { ContentBlock } from "../../services/converted-session-types.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import type { SessionId } from "../types/session-id.js";
import type {
	ConnectionStatus,
	SessionCapabilities,
	ThreadConnection,
} from "../types/thread-connection.js";
import type { ThreadState } from "../types/thread-state.js";
import { createLogger } from "../utils/logger.js";
import { AcpClient } from "./acp-client.js";

/**
 * Error types for connection manager operations.
 */
export class ConnectionManagerError extends Error {
	constructor(
		message: string,
		public readonly code: ConnectionManagerErrorCode,
		public readonly cause?: Error
	) {
		super(message);
		this.name = "ConnectionManagerError";
	}
}

export type ConnectionManagerErrorCode =
	| "CONNECTION_FAILED"
	| "RESUME_FAILED"
	| "SEND_FAILED"
	| "CANCEL_FAILED"
	| "NOT_CONNECTED"
	| "ALREADY_CONNECTING";

/**
 * Connection manager for lazy thread activation.
 *
 * Thread-Scoped Sessions (1:1 mapping):
 * - Each thread has its own independent ACP session
 * - Connections are established lazily when a user wants to interact
 * - Each thread's connection is tracked and cleaned up independently
 * - This enables unlimited parallel agents on the same project
 *
 * Key features:
 * - Lazy connection: Only connect when the user wants to send a message
 * - Capability-based resume: Try to resume if agent supports it
 * - Thread isolation: Each thread has its own session (no sharing)
 */
export class ConnectionManager {
	private readonly logger = createLogger({
		id: LOGGER_IDS.CONNECTION_MANAGER,
		name: "Connection Manager",
	});

	private readonly connections = new Map<string, ThreadConnection>();
	private readonly connecting = new Map<
		string,
		ResultAsync<ThreadConnection, ConnectionManagerError>
	>();
	private readonly acpClient: AcpClient;

	constructor(acpClient?: AcpClient) {
		this.acpClient = acpClient ?? new AcpClient();
	}

	/**
	 * Ensure a thread has an active connection.
	 *
	 * If the thread already has a connection, returns it.
	 * If not, creates a new connection (or resumes if supported).
	 *
	 * @param thread - The thread to connect
	 * @returns The thread connection
	 */
	ensureConnection(thread: ThreadState): ResultAsync<ThreadConnection, ConnectionManagerError> {
		this.logger.debug("ensureConnection() for thread:", thread.id);

		// Already connected?
		const existing = this.connections.get(thread.id);
		if (existing) {
			this.logger.debug("Thread already connected:", thread.id);
			return okAsync(existing);
		}

		// Connection in progress?
		const pending = this.connecting.get(thread.id);
		if (pending) {
			this.logger.debug("Connection already in progress:", thread.id);
			return pending;
		}

		// Start new connection
		const connectionResultAsync = this.connect(thread);
		this.connecting.set(thread.id, connectionResultAsync);

		return connectionResultAsync
			.map((connection) => {
				this.connections.set(thread.id, connection);
				this.connecting.delete(thread.id);
				return connection;
			})
			.mapErr((error) => {
				this.connecting.delete(thread.id);
				return error;
			});
	}

	/**
	 * Internal method to establish a connection.
	 */
	private connect(thread: ThreadState): ResultAsync<ThreadConnection, ConnectionManagerError> {
		this.logger.info("Connecting thread:", thread.id, "to agent:", thread.agentId);

		// Try to resume existing session if thread has history
		// For historical threads (from .jsonl files), the thread.id is the session ID
		const hasHistory = thread.source === "historical" || thread.entries.length > 0;
		const sessionIdToResume = hasHistory ? thread.id : null;

		// Use discriminated union types for type-safe session response handling
		const sessionResultAsync = sessionIdToResume
			? this.acpClient
					.resumeSessionSafe(sessionIdToResume, thread.projectPath, thread.agentId)
					.orElse((error) => {
						this.logger.warn(
							"Resume failed for thread:",
							thread.id,
							"falling back to new session. Error:",
							error.message
						);
						return this.acpClient.createSession(thread.projectPath, thread.agentId);
					})
			: this.acpClient.createSession(thread.projectPath, thread.agentId);

		return sessionResultAsync
			.map((sessionResponse) => {
				// Build capabilities from session response
				// TECH-DEBT: canResume/canFork should come from ACP when supported
				const capabilities: SessionCapabilities = {
					canResume: true, // Enable resume capability
					canFork: false,
					supportedModes: sessionResponse.modes.availableModes.map((m: { id: string }) => m.id),
					supportedModels: sessionResponse.models.availableModels.map(
						(m: { modelId: string }) => m.modelId
					),
					// Store full mode/model objects for UI pickers
					availableModes: sessionResponse.modes.availableModes,
					availableModels: sessionResponse.models.availableModels,
					currentModeId: sessionResponse.modes.currentModeId,
					currentModelId: sessionResponse.models.currentModelId,
				};

				// Extract the ACP session ID using type-safe discriminated union pattern matching
				const acpSessionId =
					sessionResponse.type === "resume"
						? sessionIdToResume! // We know this exists because we only call resumeSessionSafe when sessionIdToResume is truthy
						: sessionResponse.sessionId;

				const connection: ThreadConnection = {
					acpSessionId,
					capabilities,
					connectedAt: new Date(),
				};

				this.logger.info(
					"Thread connected:",
					thread.id,
					"ACP session:",
					connection.acpSessionId,
					"Session type:",
					sessionResponse.type
				);

				return connection;
			})
			.mapErr((error) => {
				return new ConnectionManagerError(
					`Failed to create session: ${error.message}`,
					"CONNECTION_FAILED",
					error
				);
			});
	}

	/**
	 * Disconnect a thread.
	 *
	 * Releases the ACP session associated with the thread.
	 *
	 * @param threadId - The thread ID to disconnect
	 */
	disconnect(threadId: string): ResultAsync<void, ConnectionManagerError> {
		this.logger.debug("disconnect() for thread:", threadId);

		const connection = this.connections.get(threadId);
		if (!connection) {
			this.logger.debug("Thread not connected:", threadId);
			return okAsync();
		}

		// Remove from our tracking
		this.connections.delete(threadId);

		// TECH-DEBT: Should send cancel/cleanup to ACP to properly release the session
		// Currently sessions are just abandoned when disconnected

		this.logger.info("Thread disconnected:", threadId);
		return okAsync();
	}

	/**
	 * Send a message on an active connection.
	 *
	 * @param threadId - The thread ID
	 * @param content - The message content
	 */
	sendMessage(
		threadId: string,
		content: ContentBlock[]
	): ResultAsync<void, ConnectionManagerError> {
		this.logger.debug("sendMessage() for thread:", threadId);

		const connection = this.connections.get(threadId);
		if (!connection) {
			return ResultAsync.fromSafePromise(
				Promise.reject(new ConnectionManagerError("Thread not connected", "NOT_CONNECTED"))
			);
		}

		return this.acpClient
			.sendPrompt(connection.acpSessionId, content)
			.map(() => {
				this.logger.debug("Message sent for thread:", threadId);
				return undefined;
			})
			.mapErr(
				(error) =>
					new ConnectionManagerError(
						`Failed to send message: ${error.message}`,
						"SEND_FAILED",
						error
					)
			);
	}

	/**
	 * Cancel an in-flight request.
	 *
	 * @param threadId - The thread ID
	 */
	cancel(threadId: string): ResultAsync<void, ConnectionManagerError> {
		this.logger.debug("cancel() for thread:", threadId);

		const connection = this.connections.get(threadId);
		if (!connection) {
			return ResultAsync.fromSafePromise(
				Promise.reject(new ConnectionManagerError("Thread not connected", "NOT_CONNECTED"))
			);
		}

		return this.acpClient
			.cancel(connection.acpSessionId)
			.map(() => {
				this.logger.debug("Request cancelled for thread:", threadId);
				return undefined;
			})
			.mapErr(
				(error) =>
					new ConnectionManagerError(`Failed to cancel: ${error.message}`, "CANCEL_FAILED", error)
			);
	}

	/**
	 * Get connection status for a thread.
	 */
	getStatus(threadId: string): ConnectionStatus {
		const connection = this.connections.get(threadId);
		if (connection) {
			return { type: "connected", connection };
		}

		if (this.connecting.has(threadId)) {
			return { type: "connecting" };
		}

		return { type: "disconnected" };
	}

	/**
	 * Get the ACP session ID for a thread.
	 *
	 * Returns undefined if the thread is not connected.
	 */
	getAcpSessionId(threadId: string): SessionId | undefined {
		return this.connections.get(threadId)?.acpSessionId;
	}

	/**
	 * Check if a thread is connected.
	 */
	isConnected(threadId: string): boolean {
		return this.connections.has(threadId);
	}

	/**
	 * Get all connected thread IDs.
	 */
	getConnectedThreadIds(): string[] {
		return Array.from(this.connections.keys());
	}

	/**
	 * Disconnect all threads.
	 */
	disconnectAll(): void {
		this.logger.info("Disconnecting all threads");
		for (const threadId of this.connections.keys()) {
			this.disconnect(threadId).mapErr((error) => {
				this.logger.warn("Failed to disconnect thread:", {
					threadId,
					error: error.message,
				});
				return error;
			});
		}
	}
}

/**
 * Create a new connection manager instance.
 */
export function createConnectionManager(acpClient?: AcpClient): ConnectionManager {
	return new ConnectionManager(acpClient);
}
