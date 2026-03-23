/**
 * Raw Streaming Data Store - Records raw SessionUpdate events for debugging.
 *
 * This store is only active in development mode. It captures all streaming
 * events as they arrive for later export and analysis.
 */

import type { SessionUpdate } from "../../services/converted-session-types.js";

interface TimestampedUpdate {
	timestamp: number;
	update: SessionUpdate;
}

/**
 * Store for raw streaming data, only active in dev mode.
 */
class RawStreamingStore {
	private eventsBySessionId = new Map<string, TimestampedUpdate[]>();
	private readonly maxEventsPerSession = 10000;

	/**
	 * Record a raw SessionUpdate event.
	 */
	record(sessionId: string, update: SessionUpdate): void {
		if (!import.meta.env.DEV) {
			return;
		}

		let events = this.eventsBySessionId.get(sessionId);
		if (!events) {
			events = [];
			this.eventsBySessionId.set(sessionId, events);
		}

		events.push({
			timestamp: Date.now(),
			update,
		});

		// Prevent memory issues by capping events
		if (events.length > this.maxEventsPerSession) {
			events.shift();
		}
	}

	/**
	 * Get all recorded events for a session.
	 */
	getEvents(sessionId: string): TimestampedUpdate[] {
		return this.eventsBySessionId.get(sessionId) ?? [];
	}

	/**
	 * Export raw streaming data as a JSON string.
	 */
	exportAsJson(sessionId: string): string {
		const events = this.getEvents(sessionId);
		return JSON.stringify(
			{
				sessionId,
				exportedAt: new Date().toISOString(),
				eventCount: events.length,
				events,
			},
			null,
			2
		);
	}

	/**
	 * Clear recorded events for a session.
	 */
	clear(sessionId: string): void {
		this.eventsBySessionId.delete(sessionId);
	}

	/**
	 * Clear all recorded events.
	 */
	clearAll(): void {
		this.eventsBySessionId.clear();
	}

	/**
	 * Get count of recorded events for a session.
	 */
	getEventCount(sessionId: string): number {
		return this.eventsBySessionId.get(sessionId)?.length ?? 0;
	}
}

// Singleton instance
export const rawStreamingStore = new RawStreamingStore();
