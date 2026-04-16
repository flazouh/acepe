/**
 * Connection Manager Interface
 *
 * Narrow interface for managing connection state machines.
 * Extracted services use this for state machine operations.
 */

import type { SessionMachineSnapshot } from "../../../logic/session-machine.js";
import type { SessionMachineActor } from "../../session-connection-service.svelte.js";

/**
 * Interface for managing connection state machines.
 */
import type { ActiveTurnFailure } from "../../../types/turn-error.js";

export interface IConnectionManager {
	// ============================================
	// STATE MACHINE ACCESS
	// ============================================

	/**
	 * Create or get session machine for a session.
	 */
	createOrGetMachine(sessionId: string): SessionMachineActor;

	/**
	 * Get session machine for a session.
	 */
	getMachine(sessionId: string): SessionMachineActor | null;

	/**
	 * Get session machine state.
	 * Returns a reactive value when read inside Svelte $derived() blocks.
	 */
	getState(sessionId: string): SessionMachineSnapshot | null;

	/**
	 * Remove session machine when session is removed.
	 */
	removeMachine(sessionId: string): void;

	// ============================================
	// CONNECTION STATE TRACKING
	// ============================================

	/**
	 * Check if a session is currently connecting.
	 */
	isConnecting(sessionId: string): boolean;

	/**
	 * Mark a session as connecting.
	 */
	setConnecting(sessionId: string, connecting: boolean): void;

	// ============================================
	// STATE MACHINE EVENTS
	// ============================================

	/**
	 * Send content loading events to state machine.
	 */
	sendContentLoad(sessionId: string): void;

	/**
	 * Send content loaded event to state machine.
	 */
	sendContentLoaded(sessionId: string): void;

	/**
	 * Send content load error event to state machine.
	 */
	sendContentLoadError(sessionId: string): void;

	/**
	 * Send connection start event to state machine.
	 */
	sendConnectionConnect(sessionId: string): void;

	/**
	 * Send connection success event to state machine.
	 */
	sendConnectionSuccess(sessionId: string): void;

	/**
	 * Send capabilities loaded event to state machine.
	 * This event is sent after both modes and models have been loaded from the agent.
	 */
	sendCapabilitiesLoaded(sessionId: string): void;

	/**
	 * Send connection error event to state machine.
	 */
	sendConnectionError(sessionId: string): void;

	/**
	 * Send turn failure event to state machine.
	 */
	sendTurnFailed(
		sessionId: string,
		failure: ActiveTurnFailure
	): void;

	/**
	 * Send disconnect event to state machine.
	 */
	sendDisconnect(sessionId: string): void;

	/**
	 * Send message sent event to state machine.
	 */
	sendMessageSent(sessionId: string): void;

	/**
	 * Send response started event to state machine.
	 */
	sendResponseStarted(sessionId: string): void;

	/**
	 * Send response complete event to state machine.
	 */
	sendResponseComplete(sessionId: string): void;

	/**
	 * Initialize a new session's state machine to connected state.
	 */
	initializeConnectedSession(sessionId: string): void;
}
