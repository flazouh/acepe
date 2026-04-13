import type { ResultAsync } from "neverthrow";

import type { SessionStore } from "../../../store/session-store.svelte.js";
import { MessageSendError, SessionCreationError } from "../errors/agent-input-error.js";
import type { Attachment } from "../types/attachment.js";

/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
	/**
	 * Agent ID to use for the session.
	 */
	readonly agentId: string;

	/**
	 * Explicit mode selection captured before the session exists.
	 */
	readonly initialModeId?: string | null;

	/**
	 * Explicit model selection captured before the session exists.
	 */
	readonly initialModelId?: string | null;

	/**
	 * Whether Autonomous should be enabled immediately after session creation.
	 */
	readonly initialAutonomousEnabled?: boolean | null;

	/**
	 * Project path for the session.
	 */
	readonly projectPath: string;

	/**
	 * Project name for display.
	 */
	readonly projectName: string;

	/**
	 * Optional eager session title derived before the first send finishes.
	 */
	readonly title?: string | null;

	/**
	 * Optional worktree path for sessions operating in git worktrees.
	 * Used for correct path conversion when creating checkpoints.
	 */
	readonly worktreePath?: string;

	readonly launchToken?: string;
}

/**
 * Creates a new session using the store.
 *
 * @param store - The session store instance
 * @param options - Session creation options
 * @returns ResultAsync containing the session ID on success
 *
 * @example
 * ```ts
 * const result = await createSession(store, {
 *   agentId: "claude-code",
 *   projectPath: "/path/to/project",
 *   projectName: "My Project"
 * });
 * if (result.isOk()) {
 *   const sessionId = result.value;
 * }
 * ```
 */
export function createSession(
	store: SessionStore,
	options: CreateSessionOptions
): ResultAsync<string, SessionCreationError> {
	return store
		.createSession({
			agentId: options.agentId,
			initialAutonomousEnabled: options.initialAutonomousEnabled === true,
			initialModeId: options.initialModeId ?? undefined,
			initialModelId: options.initialModelId ?? undefined,
			projectPath: options.projectPath,
			title: options.title ?? undefined,
			worktreePath: options.worktreePath,
			launchToken: options.launchToken,
		})
		.map((session) => session.id)
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
 * Sends a message to a session.
 *
 * @param store - The session store instance
 * @param sessionId - The session ID to send the message to
 * @param message - The message text to send
 * @returns ResultAsync containing void on success
 *
 * @example
 * ```ts
 * const result = await sendMessage(store, "session-123", "Hello");
 * if (result.isErr()) {
 *   // Handle error
 * }
 * ```
 */
export function sendMessage(
	store: SessionStore,
	sessionId: string,
	message: string,
	attachments: readonly Attachment[] = []
): ResultAsync<void, MessageSendError> {
	return store
		.sendMessage(sessionId, message, attachments)
		.mapErr(
			(error) =>
				new MessageSendError(
					sessionId,
					message,
					error instanceof Error ? error : new Error(String(error))
				)
		);
}
