import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PanelConnectionState,
	type PanelConnectionErrorDetails,
} from "../../../../types/panel-connection-state.js";
import { ConnectionController } from "../connection-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("ConnectionController", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	type ConnectionChangeCallback = (
		panelId: string,
		state: PanelConnectionState,
		context: { error?: PanelConnectionErrorDetails }
	) => void;

	function createStoreStub() {
		let state: PanelConnectionState | null = null;
		let error: PanelConnectionErrorDetails | null = null;
		const listeners = new Set<ConnectionChangeCallback>();
		const store = {
			getState: () => state,
			getContext: () => (error === null ? null : { error }),
			onChange: (callback: ConnectionChangeCallback) => {
				listeners.add(callback);
				return () => listeners.delete(callback);
			},
			push: (nextState: PanelConnectionState, nextError: PanelConnectionErrorDetails | null = null) => {
				state = nextState;
				error = nextError;
				for (const listener of listeners) {
					listener("panel-1", nextState, { error: nextError ?? undefined });
				}
			},
		};
		return store;
	}

	const make = (stillFailed = true, panelId: string | null = "panel-1") => {
		const holder = { stillFailed };
		const store = createStoreStub();
		const c = new ConnectionController({
			getStillFailed: () => holder.stillFailed,
			connectionStore: store as never,
			getPanelId: () => panelId,
		});
		return { c, holder, store };
	};

	it("updates read-only state/error from the store subscription without external setters", () => {
		const { c, store } = make();
		c.syncSubscription();
		expect(c.state).toBeNull();

		store.push(PanelConnectionState.CONNECTING);
		expect(c.state).toBe(PanelConnectionState.CONNECTING);

		store.push(PanelConnectionState.ERROR, { message: "boom" });
		expect(c.state).toBe(PanelConnectionState.ERROR);
		expect(c.error?.message).toBe("boom");
		c.dispose();
	});

	it("tracks dismissed error keys through dismissError / clearDismissedError", () => {
		const { c } = make();
		expect(c.dismissedErrorKey).toBeNull();
		c.dismissError("err:abc");
		expect(c.dismissedErrorKey).toBe("err:abc");
		c.clearDismissedError();
		expect(c.dismissedErrorKey).toBeNull();
		c.dispose();
	});

	it("isRetrying = retryActive AND stillFailed (true case)", () => {
		vi.useFakeTimers();
		const { c } = make(true);
		expect(c.isRetrying).toBe(false);
		c.beginRetry();
		expect(c.isRetrying).toBe(true);
		c.dispose();
	});

	it("isRetrying stays false when the session is no longer failed", () => {
		vi.useFakeTimers();
		const { c } = make(false);
		c.beginRetry();
		expect(c.isRetrying).toBe(false);
		c.dispose();
	});

	it("beginRetry is a no-op while a retry is already in flight", () => {
		vi.useFakeTimers();
		const { c } = make(true);
		expect(c.beginRetry()).toBe(true);
		expect(c.beginRetry()).toBe(false);
		c.dispose();
	});

	it("the 4s fallback timer clears the retry-busy flag", () => {
		vi.useFakeTimers();
		const { c } = make(true);
		c.beginRetry();
		expect(c.isRetrying).toBe(true);
		vi.advanceTimersByTime(4000);
		expect(c.isRetrying).toBe(false);
	});

	it("detach ignores later store pushes after dispose", () => {
		const { c, store } = make();
		c.syncSubscription();
		store.push(PanelConnectionState.CONNECTING);
		expect(c.state).toBe(PanelConnectionState.CONNECTING);
		c.dispose();
		store.push(PanelConnectionState.ERROR, { message: "late" });
		expect(c.state).toBe(PanelConnectionState.CONNECTING);
	});

	it("does not expose state/error setters on the public instance", () => {
		const { c } = make();
		expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), "state")?.set).toBeUndefined();
		expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), "error")?.set).toBeUndefined();
		expect(
			Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), "dismissedErrorKey")?.set
		).toBeUndefined();
		c.dispose();
	});
});
