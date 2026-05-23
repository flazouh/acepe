import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleLazyPanelWork } from "./file-panel-defer.js";

describe("scheduleLazyPanelWork", () => {
	afterEach(() => {
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
});
