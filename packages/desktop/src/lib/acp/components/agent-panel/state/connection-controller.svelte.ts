/**
 * ConnectionController — owns the agent panel's panel-connection state
 * (connection state/error, dismissed-error key, retry-busy flag + timer),
 * hoisted out of the `agent-panel.svelte` god controller so it is testable in
 * isolation. The connection-store subscription and the retry/cancel/dismiss
 * handlers (which touch DOM refs + stores) stay in the component and drive this
 * via setters. `isRetrying` is a $derived (plan Decision 7) over the retry flag
 * and the session's still-failed accessor — no $effect. (Plan 2026-05-29-002 U4.)
 */
import {
	type PanelConnectionErrorDetails,
	PanelConnectionState,
} from "../../../types/panel-connection-state.js";

export interface ConnectionControllerDeps {
	/** Whether the session is still in a failed state (from the session controller). */
	getStillFailed: () => boolean;
}

export class ConnectionController {
	readonly #deps: ConnectionControllerDeps;
	#state = $state<PanelConnectionState | null>(null);
	#error = $state<PanelConnectionErrorDetails | null>(null);
	#dismissedErrorKey = $state<string | null>(null);
	#retryActive = $state(false);
	#retryBusyTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(deps: ConnectionControllerDeps) {
		this.#deps = deps;
	}

	get state(): PanelConnectionState | null {
		return this.#state;
	}
	set state(value: PanelConnectionState | null) {
		this.#state = value;
	}

	get error(): PanelConnectionErrorDetails | null {
		return this.#error;
	}
	set error(value: PanelConnectionErrorDetails | null) {
		this.#error = value;
	}

	get dismissedErrorKey(): string | null {
		return this.#dismissedErrorKey;
	}
	set dismissedErrorKey(value: string | null) {
		this.#dismissedErrorKey = value;
	}

	/**
	 * Retry-busy spinner state: true on retry, auto-clears via the 4s fallback
	 * timer; also clears as soon as the failure state transitions away.
	 */
	readonly isRetrying = $derived.by(() => this.#retryActive && this.#deps.getStillFailed());

	/**
	 * Begin a retry-busy window. Returns false (no-op) when a retry is already in
	 * flight, mirroring the original handler's early-return guard.
	 */
	beginRetry(): boolean {
		if (this.isRetrying) {
			return false;
		}
		this.#retryActive = true;
		if (this.#retryBusyTimer !== null) {
			clearTimeout(this.#retryBusyTimer);
		}
		this.#retryBusyTimer = setTimeout(() => {
			this.#retryActive = false;
			this.#retryBusyTimer = null;
		}, 4000);
		return true;
	}

	/** Clear the busy timer on teardown. */
	dispose(): void {
		if (this.#retryBusyTimer !== null) {
			clearTimeout(this.#retryBusyTimer);
			this.#retryBusyTimer = null;
		}
	}
}
