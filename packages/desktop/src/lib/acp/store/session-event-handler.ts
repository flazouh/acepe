/**
 * Session Event Handler Interface
 *
 * Narrow interface defining what SessionEventService needs from a store.
 * This breaks the circular dependency between SessionEventService and SessionStore.
 */

import type { SessionStateEnvelope, SessionStateGraph } from "../../services/acp-types.js";
import type { TurnErrorUpdate } from "../types/turn-error.js";
import type { SessionCold, SessionTransientProjection } from "./types.js";

/**
 * Interface for handling session events.
 *
 * SessionStore implements this interface, allowing SessionEventService
 * to depend on the interface rather than the concrete class.
 */
export interface SessionEventHandler {
	/**
	 * Get session cold data by ID from the store.
	 */
	getSessionCold(sessionId: string): SessionCold | undefined;

	/**
	 * Check if a session's entries have been preloaded from disk.
	 */
	isPreloaded(sessionId: string): boolean;

	/**
	 * Get hot state for a session.
	 */
	getHotState(sessionId: string): SessionTransientProjection;
	getSessionCanSend(sessionId: string): boolean | null;
	hasPendingCreationSession?(sessionId: string): boolean;
	materializePendingCreationSession?(sessionId: string): boolean;
	failPendingCreationSession?(sessionId: string, update: TurnErrorUpdate): void;
	ensureSessionFromStateGraph?(graph: SessionStateGraph): boolean;

	/**
	 * Update usage telemetry for a session (spend + tokens).
	 * Called when a usageTelemetryUpdate session update is received.
	 */
	updateUsageTelemetry(
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	): void;

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void;
}
