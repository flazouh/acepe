import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionController } from "../connection-controller.svelte.js";

/** Vitest (not Bun): the controller uses Svelte 5 runes. */
describe("ConnectionController", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const make = (stillFailed = true) => {
		const holder = { stillFailed };
		const c = new ConnectionController({ getStillFailed: () => holder.stillFailed });
		return { c, holder };
	};

	it("stores connection state / error / dismissed-error key", () => {
		const { c } = make();
		expect(c.state).toBeNull();
		c.dismissedErrorKey = "err:abc";
		expect(c.dismissedErrorKey).toBe("err:abc");
	});

	it("isRetrying = retryActive AND stillFailed (true case)", () => {
		vi.useFakeTimers();
		const { c } = make(true);
		expect(c.isRetrying).toBe(false); // not retrying yet
		c.beginRetry();
		expect(c.isRetrying).toBe(true);
		c.dispose();
	});

	it("isRetrying stays false when the session is no longer failed", () => {
		vi.useFakeTimers();
		const { c } = make(false); // stillFailed = false
		c.beginRetry();
		expect(c.isRetrying).toBe(false);
		c.dispose();
	});

	it("beginRetry is a no-op while a retry is already in flight", () => {
		vi.useFakeTimers();
		const { c } = make(true);
		expect(c.beginRetry()).toBe(true);
		expect(c.beginRetry()).toBe(false); // already retrying
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
});
