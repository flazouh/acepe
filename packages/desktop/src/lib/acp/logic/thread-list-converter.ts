import type { SessionSummary } from "../application/dto/session.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import {
	type SessionDisplayItem,
	sessionSummaryToDisplayItem,
} from "../types/thread-display-item.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: LOGGER_IDS.THREAD_LIST_CONVERTER,
	name: "Thread List Converter",
});

/**
 * Converts a SessionSummary to a SessionDisplayItem.
 *
 * Session Identity: session.id IS the canonical identifier.
 *
 * @param session - The session to convert
 * @returns SessionDisplayItem
 */
export function convertSessionToDisplayItem(session: SessionSummary): SessionDisplayItem {
	return sessionSummaryToDisplayItem(session);
}

/**
 * Converts an array of SessionSummary objects to SessionDisplayItem objects.
 *
 * @param sessions - Array of sessions
 * @returns Array of session display items
 */
export function convertSessionsToDisplayItems(sessions: SessionSummary[]): SessionDisplayItem[] {
	return sessions.map(convertSessionToDisplayItem);
}

/**
 * Merges active sessions and historical conversations, deduplicating by id.
 * Active sessions take precedence over historical conversations.
 *
 * Session Identity: id IS the session ID, so deduplication by id
 * ensures one entry per session.
 *
 * @param activeSessions - Array of active session display items
 * @param historicalConversations - Array of historical conversation display items
 * @returns Merged and sorted array of display items
 */
export function mergeAndSortSessions(
	activeSessions: SessionDisplayItem[],
	historicalConversations: SessionDisplayItem[]
): SessionDisplayItem[] {
	logger.info(
		"Merging",
		activeSessions.length,
		"active sessions and",
		historicalConversations.length,
		"historical conversations"
	);

	// Create a map to deduplicate by id (which IS the session ID)
	const idMap = new Map<string, SessionDisplayItem>();

	// First add historical conversations
	for (const item of historicalConversations) {
		idMap.set(item.id, item);
	}

	// Then add/override with active sessions (prefer active if both exist)
	for (const item of activeSessions) {
		idMap.set(item.id, item);
	}

	// Convert map to array and sort by createdAt descending (most recent first)
	const merged = Array.from(idMap.values());
	merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	logger.info("After deduplication:", merged.length, "unique sessions");

	return merged;
}
