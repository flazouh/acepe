import { describe, expect, it } from "bun:test";

import { createDomViewportScheduler } from "./dom-scheduler.ts";

describe("createDomViewportScheduler", () => {
	it("cancels a scheduled frame and timeout through the injected host", () => {
		const cancelledFrames: Array<number> = [];
		const cancelledTimeouts: Array<number> = [];
		const scheduler = createDomViewportScheduler({
			requestFrame: (_run) => 7,
			cancelFrame: (id) => {
				cancelledFrames.push(id);
			},
			requestTimeout: (_run, delayMs) => {
				expect(delayMs).toBe(50);
				return 9;
			},
			cancelTimeout: (id) => {
				cancelledTimeouts.push(id);
			},
		});
		const cancelFrame = scheduler.scheduleFrame(() => {});
		cancelFrame();
		const cancelTimeout = scheduler.scheduleTimeout(() => {}, 50);
		cancelTimeout();
		expect(cancelledFrames).toEqual([7]);
		expect(cancelledTimeouts).toEqual([9]);
	});
});
