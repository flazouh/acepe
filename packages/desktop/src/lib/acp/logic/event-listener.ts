import { ResultAsync as RA, type ResultAsync } from "neverthrow";

import type { AcpError } from "../errors/index.js";

import { ProtocolError } from "../errors/index.js";

export interface EventListenerConfig {
	tauriListen: (
		eventName: string,
		callback: (event: { payload: unknown }) => void
	) => Promise<() => void>;
	logger?: {
		info: (message: string, data?: unknown) => void;
		debug: (message: string, data?: unknown) => void;
		warn: (message: string, data?: unknown) => void;
		error: (message: string, data?: unknown) => void;
	};
}

/**
 * Manages Tauri event subscription for session updates.
 *
 * Responsibilities:
 * - Subscribe to the "acp-session-update" Tauri event
 * - Invoke the callback for each event received
 * - Handle subscription/unsubscription lifecycle
 * - Convert errors to AcpError
 *
 * Note: The actual parsing and validation of session updates
 * is handled by the session update parser.
 */
export function createEventListener(config: EventListenerConfig) {
	const {
		tauriListen,
		logger = {
			info: () => {},
			debug: () => {},
			warn: () => {},
			error: () => {},
		},
	} = config;

	let unlistenFn: (() => void) | null = null;

	/**
	 * Subscribe to session update events from Tauri.
	 *
	 * Sets up a listener for the "acp-session-update" Tauri event
	 * and invokes the callback whenever an event is received.
	 *
	 * NOTE: Calling subscribe() when already subscribed will first unsubscribe
	 * from the previous listener to prevent memory leaks and duplicate events.
	 *
	 * @param listener - Callback function to receive raw event payloads
	 * @returns ResultAsync containing void on success or an error
	 */
	function subscribe(listener: (payload: unknown) => void): ResultAsync<void, AcpError> {
		// Prevent memory leak: unsubscribe from previous listener if one exists
		if (unlistenFn !== null) {
			logger.warn("Already subscribed to session updates, unsubscribing previous listener first");
			unlistenFn();
			unlistenFn = null;
		}

		return RA.fromPromise(
			tauriListen("acp-session-update", (event) => {
				// Invoke the callback with the raw payload
				// Parsing and validation is handled by the parser
				listener(event.payload);
			}),
			(error) => new ProtocolError(`Failed to subscribe to session updates: ${error}`, error)
		).map((unlisten) => {
			unlistenFn = unlisten;
			return;
		});
	}

	/**
	 * Unsubscribe from session update events.
	 */
	function unsubscribe(): void {
		if (unlistenFn) {
			unlistenFn();
			unlistenFn = null;
			logger.debug("Unsubscribed from session updates");
		}
	}

	/**
	 * Check if currently listening for events (for testing).
	 */
	function hasUnlistenFn(): boolean {
		return unlistenFn !== null;
	}

	return {
		subscribe,
		unsubscribe,
		hasUnlistenFn,
	};
}

export type EventListener = ReturnType<typeof createEventListener>;
