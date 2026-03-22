/**
 * Connection Store - Manages XState panel connection machines.
 *
 * This store handles the lifecycle of XState actors for panel connection state machines,
 * which manage the connection flow for panels (connecting, error, retry, etc.).
 */

import { getContext, setContext } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { createActor } from "xstate";
import { panelConnectionMachine } from "../logic/panel-connection-machine.js";
import {
	type PanelConnectionContext,
	PanelConnectionEvent,
	PanelConnectionState,
} from "../types/panel-connection-state.js";
import { createLogger } from "../utils/logger.js";

const CONNECTION_STORE_KEY = Symbol("connection-store");
const logger = createLogger({ id: "connection-store", name: "ConnectionStore" });

type PanelConnectionActor = ReturnType<typeof createActor<typeof panelConnectionMachine>>;

export type ConnectionChangeCallback = (
	panelId: string,
	state: PanelConnectionState,
	context: PanelConnectionContext
) => void;

export class ConnectionStore {
	private actors = new SvelteMap<string, PanelConnectionActor>();
	private actorSubscriptions = new SvelteMap<string, () => void>();
	private stateCache = new SvelteMap<string, PanelConnectionState>();
	private contextCache = new SvelteMap<string, PanelConnectionContext>();
	private changeListeners = new SvelteSet<ConnectionChangeCallback>();

	onChange(callback: ConnectionChangeCallback): () => void {
		this.changeListeners.add(callback);
		return () => this.changeListeners.delete(callback);
	}

	private notifyChange(
		panelId: string,
		state: PanelConnectionState,
		context: PanelConnectionContext
	): void {
		for (const listener of this.changeListeners) {
			listener(panelId, state, context);
		}
	}

	/**
	 * Get or create a connection state machine for a panel.
	 */
	getOrCreate(panelId: string): PanelConnectionActor {
		let actor = this.actors.get(panelId);
		if (!actor) {
			actor = createActor(panelConnectionMachine, { input: { panelId } });
			actor.start();
			const subscription = actor.subscribe((snapshot) => {
				const state = snapshot.value as PanelConnectionState;
				const context = snapshot.context as PanelConnectionContext;
				const currentState = this.stateCache.get(panelId);

				this.stateCache.set(panelId, state);
				this.contextCache.set(panelId, context);

				if (currentState !== state) {
					this.notifyChange(panelId, state, context);
				}
			});
			this.actorSubscriptions.set(panelId, subscription.unsubscribe);
			this.actors.set(panelId, actor);
			logger.debug("Created panel connection machine", { panelId });
		}
		return actor;
	}

	/**
	 * Get panel connection state.
	 */
	getState(panelId: string): PanelConnectionState | null {
		return this.stateCache.get(panelId) ?? null;
	}

	/**
	 * Get panel connection context.
	 */
	getContext(panelId: string): PanelConnectionContext | null {
		return this.contextCache.get(panelId) ?? null;
	}

	/**
	 * Send event to panel connection machine.
	 */
	send(
		panelId: string,
		event:
			| {
					type: PanelConnectionEvent.START_CONNECTION;
					projectPath: string;
					agentId: string;
					title?: string;
			  }
			| { type: PanelConnectionEvent.CONNECTION_SUCCESS; sessionId: string }
			| { type: PanelConnectionEvent.CONNECTION_ERROR; error: string }
			| { type: PanelConnectionEvent.RETRY }
			| { type: PanelConnectionEvent.CANCEL }
	): void {
		const actor = this.getOrCreate(panelId);
		actor.send(event);
		logger.debug("Sent panel connection event", { panelId, event: event.type });
	}

	/**
	 * Destroy panel connection machine.
	 */
	destroy(panelId: string): void {
		const actor = this.actors.get(panelId);
		if (actor) {
			const unsubscribe = this.actorSubscriptions.get(panelId);
			if (unsubscribe) {
				unsubscribe();
				this.actorSubscriptions.delete(panelId);
			}

			const snapshot = actor.getSnapshot();
			if (
				snapshot.value === PanelConnectionState.CONNECTING ||
				snapshot.value === PanelConnectionState.ERROR
			) {
				actor.send({ type: PanelConnectionEvent.CANCEL });
			}
			actor.stop();
			this.actors.delete(panelId);
			this.stateCache.delete(panelId);
			this.contextCache.delete(panelId);
			logger.debug("Destroyed panel connection machine", { panelId });
		}
	}
}

/**
 * Create and set the connection store in Svelte context.
 */
export function createConnectionStore(): ConnectionStore {
	const store = new ConnectionStore();
	setContext(CONNECTION_STORE_KEY, store);
	return store;
}

/**
 * Get the connection store from Svelte context.
 */
export function getConnectionStore(): ConnectionStore {
	return getContext<ConnectionStore>(CONNECTION_STORE_KEY);
}
