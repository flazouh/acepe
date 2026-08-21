import { fromPromise } from "@acepe/effect-result/fromPromise";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { SessionStateEnvelope } from "../../services/acp-types.js";
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
	private listeners = new Map<string, (update: SessionUpdate, envelopeSeq: number) => void>();
	private sessionStateListeners = new Map<string, (envelope: SessionStateEnvelope) => void>();
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
	 * @returns Effect containing a unique listener ID that can be used to unsubscribe
	 */
	subscribe(
		listener: (update: SessionUpdate, envelopeSeq: number) => void
	): Effect.Effect<string, AcpError> {
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

	subscribeSessionState(
		listener: (envelope: SessionStateEnvelope) => void
	): Effect.Effect<string, AcpError> {
		const listenerId = `listener-${++this.listenerIdCounter}`;
		this.sessionStateListeners.set(listenerId, listener);
		return this.ensureSubscribed(
			listenerId,
			() => this.sessionStateListeners.has(listenerId),
			() => {
				this.sessionStateListeners.delete(listenerId);
			},
			"session state envelopes"
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
		this.sessionStateListeners.delete(listenerId);

		// If no more listeners, clean up the Tauri listener
		if (this.listeners.size === 0 && this.sessionStateListeners.size === 0 && this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
	}

	/**
	 * Get the number of active listeners.
	 */
	get listenerCount(): number {
		return this.listeners.size + this.sessionStateListeners.size;
	}

	private ensureSubscribed(
		listenerId: string,
		hasListener: () => boolean,
		removeListener: () => void,
		description: string
	): Effect.Effect<string, AcpError> {
		if (this.unlistenFn) {
			return Effect.succeed(listenerId);
		}

		if (this.isInitializing && this.initPromise) {
			const pending = this.initPromise;
			return fromPromise(
				() =>
					pending.then(() => {
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
		const program = openAcpEventSource((envelope) => {
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
					runListenerSafely(
						() => cb(update, envelope.seq),
						(error) => {
							this.logger.error("Listener threw error", { listenerId: id, error });
						}
					);
				}
				return;
			}

			if (envelope.eventName !== "acp-session-state") {
				return;
			}
			const sessionStateEnvelope = parseSessionStateEnvelopePayload(envelope.payload);
			if (!sessionStateEnvelope) {
				this.logger.warn("Discarding invalid acp-session-state payload", {
					seq: envelope.seq,
					eventName: envelope.eventName,
				});
				return;
			}
			for (const [id, cb] of this.sessionStateListeners.entries()) {
				runListenerSafely(
					() => cb(sessionStateEnvelope),
					(error) => {
						this.logger.error("Listener threw error", { listenerId: id, error });
					}
				);
			}
		}).pipe(
			Effect.map((unlisten) => {
				this.isInitializing = false;
				if (this.listeners.size === 0 && this.sessionStateListeners.size === 0) {
					unlisten();
					this.unlistenFn = null;
				} else {
					this.unlistenFn = unlisten;
				}
				return listenerId;
			}),
			Effect.mapError((error) => {
				this.isInitializing = false;
				this.unlistenFn = null;
				removeListener();
				return new ProtocolError(`Failed to subscribe to ${description}: ${error}`, error);
			})
		);

		const pending = Effect.runPromise(program)
			.then(() => undefined)
			.finally(() => {
				this.initPromise = null;
			});
		this.initPromise = pending;

		return fromPromise(
			() => pending.then(() => listenerId),
			(error) => {
				if (error instanceof ProtocolError) {
					return error;
				}
				return new ProtocolError(`Failed to wait for initialization: ${error}`, error);
			}
		);
	}
}

function runListenerSafely(run: () => void, onError: (error: unknown) => void): void {
	const listenerResult = Effect.runSync(Effect.result(fromThrowable(run, (error) => error)()));
	if (Result.isFailure(listenerResult)) {
		onError(listenerResult.failure);
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

function parseSessionStateEnvelopePayload(payload: JsonValue): SessionStateEnvelope | null {
	if (!isJsonObject(payload)) {
		return null;
	}
	if (typeof payload.sessionId !== "string") {
		return null;
	}
	if (typeof payload.graphRevision !== "number") {
		return null;
	}
	if (typeof payload.lastEventSeq !== "number") {
		return null;
	}
	if (!isJsonObject(payload.payload)) {
		return null;
	}
	if (typeof payload.payload.kind !== "string") {
		return null;
	}
	return payload as SessionStateEnvelope;
}
