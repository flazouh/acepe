import type { SessionCapabilities } from "../../types.js";

/**
 * Interface for managing session capabilities.
 * Capabilities are ACP-specific configuration (models, modes, commands)
 * that are populated on connect and cleared on disconnect.
 */
export interface ICapabilitiesManager {
	/**
	 * Get capabilities for a session.
	 * Returns default (empty) capabilities if not set.
	 */
	getCapabilities(sessionId: string): SessionCapabilities;

	/**
	 * Check if a session has capabilities set.
	 */
	hasCapabilities(sessionId: string): boolean;

	/**
	 * Update capabilities for a session.
	 */
	updateCapabilities(sessionId: string, updates: Partial<SessionCapabilities>): void;

	/**
	 * Remove capabilities for a session.
	 */
	removeCapabilities(sessionId: string): void;
}
