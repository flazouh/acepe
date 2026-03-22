import type { Plan } from "./plan.js";
import type { ThreadConnection } from "./thread-connection.js";
import type { ThreadEntry } from "./thread-entry.js";
import type { ThreadStatus } from "./thread-status.js";

/**
 * Source of a thread - where it originated from.
 *
 * - 'active': Created in this session via ACP, has live connection
 * - 'historical': Loaded from agent history files (e.g., Claude JSONL)
 * - 'database': Loaded from local database cache
 */
export type ThreadSource = "active" | "historical" | "database";

/**
 * State of an ACP thread.
 *
 * ## Thread Identity Model
 *
 * The `id` field is the agent's session ID (e.g., Claude's session UUID).
 * This is the canonical identifier used everywhere:
 * - Panel lookups
 * - Thread selection
 * - Component props
 * - Map keys
 * - Agent session operations
 *
 * The `dbId` field stores the database row ID for persistence only.
 *
 * ## Unified Model
 *
 * All threads are stored the same way regardless of source. Connection
 * to an ACP agent is established lazily when the user interacts.
 */
export type ThreadState = {
	/**
	 * Canonical thread identifier (the agent's session ID).
	 *
	 * This is the ONLY identifier used for lookups and references.
	 * It's the session ID from the agent (e.g., Claude's session UUID).
	 */
	id: string;

	/**
	 * Database row ID for persistence operations.
	 *
	 * Used internally for database queries. Null for unpersisted threads.
	 * Never use this for UI lookups - use `id` instead.
	 */
	dbId: string | null;

	/**
	 * Source of the thread - where it originated from.
	 */
	source: ThreadSource;

	/**
	 * ID of the agent that owns this thread.
	 *
	 * Examples: "claude-code", "cursor", "codex"
	 */
	agentId: string;

	/**
	 * Title of the thread.
	 */
	title: string;

	/**
	 * Current status of the thread.
	 */
	status: ThreadStatus;

	/**
	 * Entries in the thread (messages, tool calls, etc.).
	 */
	entries: ThreadEntry[];

	/**
	 * Optional error message if the thread is in an error state.
	 */
	error?: string;

	/**
	 * Optional plan for the thread.
	 */
	plan?: Plan;

	/**
	 * Path to the project folder this thread is associated with.
	 */
	projectPath: string;

	/**
	 * Display name of the project (derived from path).
	 */
	projectName: string;

	/**
	 * Timestamp when the thread was created.
	 */
	createdAt: Date;

	/**
	 * Timestamp when the thread was last updated.
	 */
	updatedAt?: Date;

	/**
	 * Timestamp when the first message was sent in this thread.
	 *
	 * Used to track when the user actually started interacting with the thread.
	 * Useful for measuring interaction latency from thread creation to first message.
	 */
	firstMessageSentAt?: Date;

	/**
	 * Active connection to an ACP agent.
	 *
	 * This is runtime-only state - not persisted.
	 * When undefined, the thread is not connected to an agent.
	 * Connection is established lazily when the user interacts.
	 */
	connection?: ThreadConnection;
};

/**
 * Check if a thread has an active connection.
 */
export function isConnected(thread: ThreadState): boolean {
	return thread.connection !== undefined;
}

/**
 * Check if a thread needs content loaded.
 *
 * Returns true if the thread has no entries and hasn't been loaded yet.
 */
export function needsContentLoad(thread: ThreadState): boolean {
	return thread.entries.length === 0 && thread.status !== "streaming";
}
