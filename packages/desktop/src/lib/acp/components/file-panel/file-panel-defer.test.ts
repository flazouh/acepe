import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleLazyPanelMetadataWork, scheduleLazyPanelWork } from "./file-panel-defer.js";

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

	it("defers panel metadata work longer than file content work", () => {
		vi.useFakeTimers();
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
});
