import { createLogger } from "../utils/logger.js";

/**
 * Routes ACP session updates to the correct thread.
 *
 * Design: Thread-Scoped Sessions (1:1 mapping)
 * - Each thread has exactly one session
 * - Each session belongs to exactly one thread
 * - This simplifies routing and eliminates multi-thread complexity
 *
 * This decouples thread identity from session identity:
 * - thread.id: stable identifier (can be historical session ID or UUID)
 * - acpSessionId: active ACP session for the thread
 */

const logger = createLogger({
	id: "update-router",
	name: "Update Router",
});

export interface UpdateRouter {
	/**
	 * Subscribe a thread to receive updates from an ACP session.
	 * Enforces 1:1 mapping - one session can only have one thread.
	 */
	subscribe(acpSessionId: string, threadId: string): void;

	/**
	 * Unsubscribe a thread from an ACP session.
	 */
	unsubscribe(acpSessionId: string, threadId: string): void;

	/**
	 * Get all thread IDs subscribed to a session.
	 * Returns a Set with 0 or 1 elements (for backward compatibility).
	 */
	getSubscribedThreads(acpSessionId: string): Set<string>;

	/**
	 * Get the single thread ID for a session (clearer API for 1:1 mapping).
	 */
	getThreadForSession(acpSessionId: string): string | undefined;

	/**
	 * Check if a thread is subscribed to any session.
	 */
	isSubscribed(threadId: string): boolean;

	/**
	 * Get the ACP session ID a thread is subscribed to.
	 */
	getSessionForThread(threadId: string): string | null;

	/**
	 * Clear all subscriptions (for cleanup).
	 */
	clear(): void;
}

/**
 * Create an UpdateRouter instance.
 * Uses O(1) lookups with bidirectional maps.
 * Enforces 1:1 mapping between sessions and threads.
 */
export function createUpdateRouter(): UpdateRouter {
	// acpSessionId → threadId (singular - 1:1 mapping)
	const sessionToThread = new Map<string, string>();

	// threadId → acpSessionId (for reverse lookup)
	const threadToSession = new Map<string, string>();

	function subscribe(acpSessionId: string, threadId: string): void {
		// Check if session already has a thread (shouldn't happen with proper usage)
		const existingThread = sessionToThread.get(acpSessionId);
		if (existingThread && existingThread !== threadId) {
			logger.warn("Session already has a thread - this indicates a bug", {
				acpSessionId,
				existingThread,
				newThread: threadId,
			});
		}

		// Remove from old session if subscribed elsewhere
		const oldSession = threadToSession.get(threadId);
		if (oldSession && oldSession !== acpSessionId) {
			unsubscribe(oldSession, threadId);
		}

		// Set 1:1 mappings
		sessionToThread.set(acpSessionId, threadId);
		threadToSession.set(threadId, acpSessionId);

		logger.debug("Thread registered to session (1:1)", {
			acpSessionId,
			threadId,
		});
	}

	function unsubscribe(acpSessionId: string, threadId: string): void {
		const currentThread = sessionToThread.get(acpSessionId);
		if (currentThread === threadId) {
			sessionToThread.delete(acpSessionId);
		}
		threadToSession.delete(threadId);

		logger.debug("Thread unsubscribed from session", {
			acpSessionId,
			threadId,
		});
	}

	function getSubscribedThreads(acpSessionId: string): Set<string> {
		const threadId = sessionToThread.get(acpSessionId);
		return threadId ? new Set([threadId]) : new Set();
	}

	function getThreadForSession(acpSessionId: string): string | undefined {
		return sessionToThread.get(acpSessionId);
	}

	function isSubscribed(threadId: string): boolean {
		return threadToSession.has(threadId);
	}

	function getSessionForThread(threadId: string): string | null {
		return threadToSession.get(threadId) || null;
	}

	function clear(): void {
		sessionToThread.clear();
		threadToSession.clear();
		logger.debug("Update router cleared");
	}

	return {
		subscribe,
		unsubscribe,
		getSubscribedThreads,
		getThreadForSession,
		isSubscribed,
		getSessionForThread,
		clear,
	};
}

// Singleton instance for app-wide routing
let updateRouterInstance: UpdateRouter | null = null;

export function getUpdateRouter(): UpdateRouter {
	if (!updateRouterInstance) {
		updateRouterInstance = createUpdateRouter();
	}
	return updateRouterInstance;
}
