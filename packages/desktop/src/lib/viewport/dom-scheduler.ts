import type { ViewportScheduler } from "@acepe/transcript-viewport";

export const createDomViewportScheduler = (input: {
	readonly requestFrame: (run: () => void) => number;
	readonly cancelFrame: (id: number) => void;
	readonly requestTimeout: (run: () => void, delayMs: number) => number;
	readonly cancelTimeout: (id: number) => void;
}): ViewportScheduler => ({
	scheduleFrame: (run) => {
		const id = input.requestFrame(run);
		return () => input.cancelFrame(id);
	},
	scheduleTimeout: (run, delayMs) => {
		const id = input.requestTimeout(run, delayMs);
		return () => input.cancelTimeout(id);
	},
});
