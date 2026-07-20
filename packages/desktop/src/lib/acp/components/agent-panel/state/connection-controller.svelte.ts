/**
 * ConnectionController — owns the agent panel's panel-connection state
 * (connection state/error, dismissed-error key, retry-busy flag + timer),
 * including the connection-store subscription. Retry/cancel/dismiss handlers
 * that touch DOM refs + stores stay in the component spine.
 */
import type { ConnectionStore } from "../../../store/connection-store.svelte.js";
import type {
	PanelConnectionErrorDetails,
	PanelConnectionState,
} from "../../../types/panel-connection-state.js";

export interface ConnectionControllerDeps {
	/** Whether the session is still in a failed state (from the session controller). */
	readonly getStillFailed: () => boolean;
	readonly connectionStore: ConnectionStore;
	readonly getPanelId: () => string | null;
}

export class ConnectionController {
	readonly #deps: ConnectionControllerDeps;
	#state = $state<PanelConnectionState | null>(null);
	#error = $state<PanelConnectionErrorDetails | null>(null);
	#dismissedErrorKey = $state<string | null>(null);
	#retryActive = $state(false);
	#retryBusyTimer: ReturnType<typeof setTimeout> | null = null;
	#unsubscribe: (() => void) | null = null;
	#attachedPanelId: string | null = null;

	constructor(deps: ConnectionControllerDeps) {
		this.#deps = deps;
	}

	get state(): PanelConnectionState | null {
		return this.#state;
	}

	get error(): PanelConnectionErrorDetails | null {
		return this.#error;
	}

	get dismissedErrorKey(): string | null {
		return this.#dismissedErrorKey;
	}

	/**
	 * Bind (or rebind) the store subscription for the current panel id. Returns a
	 * cleanup that detaches. Invoked from the controller's internal `$effect` keyed
	 * on `getPanelId()`; exposed for unit tests that run outside a Svelte root.
	 */
	syncSubscription(): () => void {
		const panelId = this.#deps.getPanelId();
		if (panelId === this.#attachedPanelId) {
			return () => {};
		}
		this.#detachSubscription();
		if (panelId === null) {
			this.#state = null;
			this.#error = null;
			return () => this.#detachSubscription();
		}

		this.#attachedPanelId = panelId;
		const store = this.#deps.connectionStore;
		this.#state = store.getState(panelId);
		this.#error = store.getContext(panelId)?.error ?? null;
		this.#unsubscribe = store.onChange((id, state, context) => {
			if (id !== panelId) {
				return;
			}
			this.#state = state;
			this.#error = context.error ?? null;
		});

		return () => this.#detachSubscription();
	}

	clearDismissedError(): void {
		this.#dismissedErrorKey = null;
	}

	dismissError(errorKey: string): void {
		this.#dismissedErrorKey = errorKey;
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

	/** Clear the busy timer and store subscription on teardown. */
	dispose(): void {
		this.#detachSubscription();
		if (this.#retryBusyTimer !== null) {
			clearTimeout(this.#retryBusyTimer);
			this.#retryBusyTimer = null;
		}
	}

	#detachSubscription(): void {
		if (this.#unsubscribe !== null) {
			this.#unsubscribe();
			this.#unsubscribe = null;
		}
		this.#attachedPanelId = null;
	}
}

/**
 * Host entry point: constructs the controller and owns the store subscription
 * `$effect` keyed on `getPanelId()`. Call from a Svelte component top level only.
 */
export function createConnectionController(deps: ConnectionControllerDeps): ConnectionController {
	const controller = new ConnectionController(deps);
	$effect(() => {
		deps.getPanelId();
		return controller.syncSubscription();
	});
	return controller;
}
