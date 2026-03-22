/**
 * Session status for UI state.
 *
 * Represents the lifecycle state of a session:
 * - idle: Historical session, not connected to ACP
 * - loading: Session data being loaded from disk
 * - connecting: Establishing ACP connection
 * - ready: Connected and waiting for user input
 * - streaming: Receiving response from agent
 * - paused: Stream paused by user
 * - error: Connection or processing error occurred
 */
export type SessionStatus =
	| "idle"
	| "loading"
	| "connecting"
	| "ready"
	| "streaming"
	| "paused"
	| "error";
