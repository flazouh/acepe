import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleLazyPanelMetadataWork, scheduleLazyPanelWork } from "./file-panel-defer.js";

const originalRequestIdleCallback = globalThis.requestIdleCallback;
const originalCancelIdleCallback = globalThis.cancelIdleCallback;

function setIdleCallbacks(
	requestIdleCallback: typeof globalThis.requestIdleCallback | undefined,
	cancelIdleCallback: typeof globalThis.cancelIdleCallback | undefined
): void {
	Object.defineProperty(globalThis, "requestIdleCallback", {
		configurable: true,
		writable: true,
		value: requestIdleCallback,
	});
	Object.defineProperty(globalThis, "cancelIdleCallback", {
		configurable: true,
		writable: true,
		value: cancelIdleCallback,
	});
}

describe("scheduleLazyPanelWork", () => {
	afterEach(() => {
		setIdleCallbacks(originalRequestIdleCallback, originalCancelIdleCallback);
		vi.useRealTimers();
	});

	it("defers panel work instead of running it in the click/render task", () => {
		vi.useFakeTimers();
		const work = vi.fn();

		scheduleLazyPanelWork(work);

		expect(work).not.toHaveBeenCalled();

		vi.advanceTimersByTime(15);
		expect(work).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(work).toHaveBeenCalledTimes(1);
	});

	it("can cancel lazy work when the viewed file changes", () => {
		vi.useFakeTimers();
		const work = vi.fn();

		const handle = scheduleLazyPanelWork(work);
		handle.cancel();
		vi.runAllTimers();

		expect(work).not.toHaveBeenCalled();
	});

	it("defers panel metadata work longer than file content work", () => {
		vi.useFakeTimers();
		setIdleCallbacks(undefined, undefined);
		const contentWork = vi.fn();
		const metadataWork = vi.fn();

		scheduleLazyPanelWork(contentWork);
		scheduleLazyPanelMetadataWork(metadataWork);

		vi.advanceTimersByTime(16);
		expect(contentWork).toHaveBeenCalledTimes(1);
		expect(metadataWork).not.toHaveBeenCalled();

		vi.advanceTimersByTime(233);
		expect(metadataWork).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(metadataWork).toHaveBeenCalledTimes(1);
	});

	it("schedules metadata work for browser idle when available", () => {
		vi.useFakeTimers();
		const metadataWork = vi.fn();
		const idleCallback: { current: VoidFunction | null } = { current: null };
		const requestIdleCallback = vi.fn((callback: () => void) => {
			idleCallback.current = callback;
			return 7;
		}) as unknown as typeof globalThis.requestIdleCallback;
		const cancelIdleCallback = vi.fn();
		setIdleCallbacks(requestIdleCallback, cancelIdleCallback);

		scheduleLazyPanelMetadataWork(metadataWork);

		expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
		vi.advanceTimersByTime(250);
		expect(metadataWork).not.toHaveBeenCalled();

		const callback = idleCallback.current;
		expect(callback).not.toBeNull();
		if (callback === null) {
			throw new Error("Expected metadata work to be scheduled for idle");
		}
		callback();
		expect(metadataWork).toHaveBeenCalledTimes(1);
		expect(cancelIdleCallback).not.toHaveBeenCalled();
	});

	it("cancels idle metadata work when the viewed file changes", () => {
		const metadataWork = vi.fn();
		const requestIdleCallback = vi.fn(() => 9) as unknown as typeof globalThis.requestIdleCallback;
		const cancelIdleCallback = vi.fn();
		setIdleCallbacks(requestIdleCallback, cancelIdleCallback);

		const handle = scheduleLazyPanelMetadataWork(metadataWork);
		handle.cancel();

		expect(cancelIdleCallback).toHaveBeenCalledWith(9);
		expect(metadataWork).not.toHaveBeenCalled();
	});

	it("runs idle metadata work at the max timeout if no idle slot arrives", () => {
		vi.useFakeTimers();
		const metadataWork = vi.fn();
		const requestIdleCallback = vi.fn(() => 11) as unknown as typeof globalThis.requestIdleCallback;
		const cancelIdleCallback = vi.fn();
		setIdleCallbacks(requestIdleCallback, cancelIdleCallback);

		scheduleLazyPanelMetadataWork(metadataWork);

		vi.advanceTimersByTime(1_999);
		expect(metadataWork).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(metadataWork).toHaveBeenCalledTimes(1);
		expect(cancelIdleCallback).toHaveBeenCalledWith(11);
	});
});
