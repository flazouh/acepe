import { okAsync, ResultAsync } from "neverthrow";

import type { JsonValue, SessionUpdate } from "../../services/converted-session-types.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { type AcpError, ProtocolError } from "../errors/index.js";
import { createLogger } from "../utils/logger.js";
import { openAcpEventSource } from "./acp-event-bridge.js";

/**
 * Subscribes to Tauri events for session updates.
 *
 * This subscriber listens for `acp-session-update` events from the Tauri backend.
 * Session updates are already parsed and typed by the Rust backend.
 *
 * Supports multiple listeners via a single Tauri event listener (fan-out pattern).
 * This prevents memory leaks from creating multiple Tauri listeners.
 */
export class EventSubscriber {
	private unlistenFn: (() => void) | null = null;
	private listeners = new Map<string, (update: SessionUpdate) => void>();
	private listenerIdCounter = 0;
	private isInitializing = false;
	private initPromise: Promise<void> | null = null;
	private readonly logger = createLogger({
		id: LOGGER_IDS.EVENT_SUBSCRIBER,
		name: "Event Subscriber",
	});

	/**
	 * Subscribe to session update events.
	 * Multiple listeners are supported - they all receive updates from a single Tauri listener.
	 *
	 * @param listener - Callback function to receive session updates
	 * @returns ResultAsync containing a unique listener ID that can be used to unsubscribe
	 */
	subscribe(listener: (update: SessionUpdate) => void): ResultAsync<string, AcpError> {
		const listenerId = `listener-${++this.listenerIdCounter}`;
		this.listeners.set(listenerId, listener);

		// If we already have a Tauri listener, just return the ID
		if (this.unlistenFn) {
			return okAsync(listenerId);
		}

		// If initialization is in progress, wait for it
		if (this.isInitializing && this.initPromise) {
			return ResultAsync.fromPromise(
				this.initPromise.then(() => {
					// Initialization may complete after this specific listener unsubscribed.
					if (!this.listeners.has(listenerId)) {
						throw new Error("Listener was removed during subscriber initialization");
					}
					return listenerId;
				}),
				(error) => {
					this.listeners.delete(listenerId);
					return new ProtocolError(`Failed to wait for initialization: ${error}`, error);
				}
			);
		}

		// Create the single ACP event bridge listener that fans out to all registered callbacks.
		this.isInitializing = true;
		const listenResult = openAcpEventSource((envelope) => {
			if (envelope.eventName !== "acp-session-update") {
				return;
			}
			const update = parseSessionUpdatePayload(envelope.payload);
			if (!update) {
				this.logger.warn("Discarding invalid acp-session-update payload", {
					seq: envelope.seq,
					eventName: envelope.eventName,
				});
				return;
			}

			// Fan out to all registered listeners
			// Wrap each callback in try-catch so a single failure does not skip subsequent listeners
			for (const [id, cb] of this.listeners.entries()) {
				try {
					cb(update);
				} catch (error) {
					this.logger.error("Listener threw error", { listenerId: id, error });
				}
			}
		})
			.map((unlisten) => {
				this.isInitializing = false;
				// If all listeners unsubscribed while initialization was in flight,
				// immediately release the native Tauri listener to avoid leaks.
				if (this.listeners.size === 0) {
					unlisten();
					this.unlistenFn = null;
				} else {
					this.unlistenFn = unlisten;
				}
				return listenerId;
			})
			.mapErr((error) => {
				this.isInitializing = false;
				this.unlistenFn = null;
				this.listeners.delete(listenerId);
				return new ProtocolError(`Failed to subscribe to session updates: ${error}`, error);
			});

		// Store promise for awaiting in concurrent subscribe calls
		// Propagate initialization failures so waiting subscribers can recover.
		this.initPromise = listenResult
			.match(
				() => undefined,
				(error) => {
					throw error;
				}
			)
			.then(() => undefined)
			.finally(() => {
				this.initPromise = null;
			});

		return listenResult;
	}

	/**
	 * Unsubscribe a specific listener by ID.
	 * The Tauri listener is only removed when all listeners are unsubscribed.
	 *
	 * @param listenerId - The ID returned from subscribe()
	 */
	unsubscribeById(listenerId: string): void {
		this.listeners.delete(listenerId);

		// If no more listeners, clean up the Tauri listener
		if (this.listeners.size === 0 && this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
	}

	/**
	 * Unsubscribe all listeners and clean up the Tauri listener.
	 * @deprecated Use unsubscribeById for proper cleanup. This removes ALL listeners.
	 */
	unsubscribe(): void {
		this.listeners.clear();
		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
	}

	/**
	 * Get the number of active listeners.
	 */
	get listenerCount(): number {
		return this.listeners.size;
	}
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionUpdatePayload(payload: JsonValue): SessionUpdate | null {
	if (!isJsonObject(payload)) {
		return null;
	}
	const updateType = payload.type;
	if (typeof updateType !== "string") {
		return null;
	}
	return payload as SessionUpdate;
}
