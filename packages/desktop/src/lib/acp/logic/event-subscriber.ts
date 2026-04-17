import { okAsync, ResultAsync } from "neverthrow";

import type { TranscriptDelta } from "../../services/acp-types.js";
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
	private transcriptDeltaListeners = new Map<string, (delta: TranscriptDelta) => void>();
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
		return this.ensureSubscribed(
			listenerId,
			() => this.listeners.has(listenerId),
			() => {
				this.listeners.delete(listenerId);
			},
			"session updates"
		);
	}

	subscribeTranscriptDeltas(
		listener: (delta: TranscriptDelta) => void
	): ResultAsync<string, AcpError> {
		const listenerId = `listener-${++this.listenerIdCounter}`;
		this.transcriptDeltaListeners.set(listenerId, listener);
		return this.ensureSubscribed(
			listenerId,
			() => this.transcriptDeltaListeners.has(listenerId),
			() => {
				this.transcriptDeltaListeners.delete(listenerId);
			},
			"transcript deltas"
		);
	}

	/**
	 * Unsubscribe a specific listener by ID.
	 * The Tauri listener is only removed when all listeners are unsubscribed.
	 *
	 * @param listenerId - The ID returned from subscribe()
	 */
	unsubscribeById(listenerId: string): void {
		this.listeners.delete(listenerId);
		this.transcriptDeltaListeners.delete(listenerId);

		// If no more listeners, clean up the Tauri listener
		if (this.listeners.size === 0 && this.transcriptDeltaListeners.size === 0 && this.unlistenFn) {
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
		this.transcriptDeltaListeners.clear();
		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
	}

	/**
	 * Get the number of active listeners.
	 */
	get listenerCount(): number {
		return this.listeners.size + this.transcriptDeltaListeners.size;
	}

	private ensureSubscribed(
		listenerId: string,
		hasListener: () => boolean,
		removeListener: () => void,
		description: string
	): ResultAsync<string, AcpError> {
		if (this.unlistenFn) {
			return okAsync(listenerId);
		}

		if (this.isInitializing && this.initPromise) {
			return ResultAsync.fromPromise(
				this.initPromise.then(() => {
					if (!hasListener()) {
						throw new Error("Listener was removed during subscriber initialization");
					}
					return listenerId;
				}),
				(error) => {
					removeListener();
					return new ProtocolError(`Failed to wait for initialization: ${error}`, error);
				}
			);
		}

		this.isInitializing = true;
		const listenResult = openAcpEventSource((envelope) => {
			if (envelope.eventName === "acp-session-update") {
				const update = parseSessionUpdatePayload(envelope.payload);
				if (!update) {
					this.logger.warn("Discarding invalid acp-session-update payload", {
						seq: envelope.seq,
						eventName: envelope.eventName,
					});
					return;
				}
				for (const [id, cb] of this.listeners.entries()) {
					try {
						cb(update);
					} catch (error) {
						this.logger.error("Listener threw error", { listenerId: id, error });
					}
				}
				return;
			}

			if (envelope.eventName !== "acp-transcript-delta") {
				return;
			}
			const delta = parseTranscriptDeltaPayload(envelope.payload);
			if (!delta) {
				this.logger.warn("Discarding invalid acp-transcript-delta payload", {
					seq: envelope.seq,
					eventName: envelope.eventName,
				});
				return;
			}
			for (const [id, cb] of this.transcriptDeltaListeners.entries()) {
				try {
					cb(delta);
				} catch (error) {
					this.logger.error("Listener threw error", { listenerId: id, error });
				}
			}
		})
			.map((unlisten) => {
				this.isInitializing = false;
				if (this.listeners.size === 0 && this.transcriptDeltaListeners.size === 0) {
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
				removeListener();
				return new ProtocolError(`Failed to subscribe to ${description}: ${error}`, error);
			});

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

function parseTranscriptDeltaPayload(payload: JsonValue): TranscriptDelta | null {
	if (!isJsonObject(payload)) {
		return null;
	}
	if (typeof payload.eventSeq !== "number") {
		return null;
	}
	if (typeof payload.sessionId !== "string") {
		return null;
	}
	if (typeof payload.snapshotRevision !== "number") {
		return null;
	}
	if (!Array.isArray(payload.operations)) {
		return null;
	}
	return payload as TranscriptDelta;
}
