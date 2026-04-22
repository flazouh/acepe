/**
 * Session Connection Service - Manages ACP connection lifecycle.
 *
 * Handles:
 * - State machine lifecycle (create, start, stop)
 * - Reactive snapshot cache (SvelteMap) for Svelte 5 signal integration
 * - Connection state tracking
 * - State machine event dispatching
 *
 * Machine snapshots are cached in a SvelteMap so that `getState()` reads
 * establish Svelte reactive dependencies. Components using
 * `$derived(store.getSessionRuntimeState(id))` automatically re-evaluate
 * when the machine transitions.
 */

import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { createActor } from "xstate";
import {
	ConnectionEvent,
	ContentEvent,
	type SessionMachineSnapshot,
	sessionMachine,
} from "../logic/session-machine.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";
import { createLogger } from "../utils/logger.js";
import type { IConnectionManager } from "./services/interfaces/index.js";

const logger = createLogger({ id: "session-connection-service", name: "SessionConnectionService" });

/**
 * Type alias for session machine actor.
 */
export type SessionMachineActor = ReturnType<typeof createActor<typeof sessionMachine>>;

/**
 * Implements IConnectionManager interface for use by extracted services.
 */
export class SessionConnectionService implements IConnectionManager {
	// State machines by session ID
	private sessionMachines = new SvelteMap<string, SessionMachineActor>();

	// Reactive snapshot cache — SvelteMap so getState() establishes Svelte dependencies
	private snapshotCache = new SvelteMap<string, SessionMachineSnapshot>();

	// Actor subscriptions for cleanup on removal
	private actorSubscriptions = new SvelteMap<string, () => void>();

	// Track sessions currently attempting to connect
	private connectingIds = new SvelteSet<string>();

	// ============================================
	// STATE MACHINE MANAGEMENT
	// ============================================

	/**
	 * Create or get session machine for a session.
	 */
	createOrGetMachine(sessionId: string): SessionMachineActor {
		let machine = this.sessionMachines.get(sessionId);
		if (!machine) {
			machine = createActor(sessionMachine, { input: { sessionId } });

			// Subscribe BEFORE start() to capture initial state.
			// Each transition synchronously writes to the SvelteMap,
			// making getState() reactive for $derived consumers.
			const sub = machine.subscribe((snapshot) => {
				this.snapshotCache.set(sessionId, snapshot.value as SessionMachineSnapshot);
			});
			this.actorSubscriptions.set(sessionId, sub.unsubscribe);

			machine.start();
			this.sessionMachines.set(sessionId, machine);
			logger.debug("Created session machine", { sessionId });
		}
		return machine;
	}

	/**
	 * Get session machine for a session.
	 */
	getMachine(sessionId: string): SessionMachineActor | null {
		return this.sessionMachines.get(sessionId) ?? null;
	}

	/**
	 * Get session machine state.
	 * Reads from the reactive SvelteMap cache — when called inside $derived(),
	 * this establishes a Svelte dependency that re-evaluates on machine transitions.
	 */
	getState(sessionId: string): SessionMachineSnapshot | null {
		return this.snapshotCache.get(sessionId) ?? null;
	}

	/**
	 * Remove session machine when session is removed.
	 * Cleanup order: unsubscribe → stop actor → delete machine → delete cache.
	 */
	removeMachine(sessionId: string): void {
		const unsub = this.actorSubscriptions.get(sessionId);
		if (unsub) {
			unsub();
			this.actorSubscriptions.delete(sessionId);
		}

		const machine = this.sessionMachines.get(sessionId);
		if (machine) {
			machine.stop();
			this.sessionMachines.delete(sessionId);
			logger.debug("Removed session machine", { sessionId });
		}

		this.snapshotCache.delete(sessionId);
	}

	// ============================================
	// CONNECTION STATE TRACKING
	// ============================================

	/**
	 * Check if a session is currently connecting.
	 */
	isConnecting(sessionId: string): boolean {
		return this.connectingIds.has(sessionId);
	}

	/**
	 * Mark a session as connecting.
	 */
	setConnecting(sessionId: string, connecting: boolean): void {
		if (connecting) {
			this.connectingIds.add(sessionId);
		} else {
			this.connectingIds.delete(sessionId);
		}
	}

	// ============================================
	// STATE MACHINE EVENTS
	// ============================================

	/**
	 * Send content loading events to state machine.
	 */
	sendContentLoad(sessionId: string): void {
		const machine = this.createOrGetMachine(sessionId);
		machine.send({ type: ContentEvent.LOAD });
	}

	/**
	 * Send content loaded event to state machine.
	 */
	sendContentLoaded(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ContentEvent.LOADED });
		}
	}

	/**
	 * Send content load error event to state machine.
	 */
	sendContentLoadError(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ContentEvent.LOAD_ERROR });
		}
	}

	/**
	 * Send connection start event to state machine.
	 */
	sendConnectionConnect(sessionId: string): void {
		const machine = this.createOrGetMachine(sessionId);
		machine.send({ type: ConnectionEvent.CONNECT });
	}

	/**
	 * Send connection success event to state machine.
	 */
	sendConnectionSuccess(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ConnectionEvent.SUCCESS });
		}
	}

	/**
	 * Send capabilities loaded event to state machine.
	 * This event is sent after both modes and models have been loaded from the agent.
	 */
	sendCapabilitiesLoaded(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (!machine) {
			logger.warn("Machine not found when sending CAPABILITIES_LOADED", { sessionId });
			return;
		}
		machine.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
	}

	/**
	 * Send connection error event to state machine.
	 */
	sendConnectionError(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ConnectionEvent.ERROR });
		}
	}

	/**
	 * Send turn failure event to state machine.
	 */
	sendTurnFailed(sessionId: string, failure: ActiveTurnFailure): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({
				type: ConnectionEvent.TURN_FAILED,
				failure,
			});
		}
	}

	/**
	 * Send disconnect event to state machine.
	 */
	sendDisconnect(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ConnectionEvent.DISCONNECT });
		}
	}

	/**
	 * Send message sent event to state machine.
	 */
	sendMessageSent(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ConnectionEvent.SEND_MESSAGE });
		}
	}

	/**
	 * Send response started event to state machine.
	 */
	sendResponseStarted(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ConnectionEvent.RESPONSE_STARTED });
		}
	}

	/**
	 * Send response complete event to state machine.
	 */
	sendResponseComplete(sessionId: string): void {
		const machine = this.getMachine(sessionId);
		if (machine) {
			machine.send({ type: ConnectionEvent.RESPONSE_COMPLETE });
		}
	}

	/**
	 * Initialize a new session's state machine to connected state.
	 * Used when creating a new session that is immediately connected.
	 */
	initializeConnectedSession(sessionId: string): void {
		const machine = this.createOrGetMachine(sessionId);
		// Content: LOADED (new session has no entries)
		machine.send({ type: ContentEvent.LOAD });
		machine.send({ type: ContentEvent.LOADED });
		// Connection: READY (already connected)
		machine.send({ type: ConnectionEvent.CONNECT });
		machine.send({ type: ConnectionEvent.SUCCESS });
		machine.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
	}
}
