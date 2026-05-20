import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createRafDedupeScheduler, scrollTailToVisibleEnd } from "../thinking-viewport-follow.js";

type QueuedFrame = {
	id: number;
	callback: FrameRequestCallback;
};

let queuedFrames: QueuedFrame[] = [];
let nextFrameId = 1;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

function flushNextFrame(timestamp: number): void {
	const frame = queuedFrames.shift();
	if (!frame) {
		throw new Error("Expected a queued animation frame");
	}
	frame.callback(timestamp);
}

describe("createRafDedupeScheduler", () => {
	beforeEach(() => {
		queuedFrames = [];
		nextFrameId = 1;
		globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
			const id = nextFrameId;
			nextFrameId += 1;
			queuedFrames.push({ id, callback });
			return id;
		};
		globalThis.cancelAnimationFrame = (id: number): void => {
			queuedFrames = queuedFrames.filter((frame) => frame.id !== id);
		};
	});

	afterEach(() => {
		globalThis.requestAnimationFrame = originalRequestAnimationFrame;
		globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
	});

	it("dedupes schedule calls to a single RAF", () => {
		let runs = 0;
		const { schedule } = createRafDedupeScheduler(() => {
			runs += 1;
		});

		schedule();
		schedule();
		expect(queuedFrames.length).toBe(1);
		flushNextFrame(0);
		expect(runs).toBe(1);
	});

	it("cancel prevents the queued frame from running", () => {
		let runs = 0;
		const { schedule, cancel } = createRafDedupeScheduler(() => {
			runs += 1;
		});

		schedule();
		cancel();
		expect(queuedFrames.length).toBe(0);
		expect(runs).toBe(0);
	});
});

describe("scrollTailToVisibleEnd", () => {
	it("sets scrollTop to max when content exceeds viewport and contentRoot is undefined", () => {
		const container = document.createElement("div") as HTMLDivElement;
		Object.defineProperty(container, "scrollHeight", { value: 200, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 40, configurable: true });

		scrollTailToVisibleEnd(container);
		expect(container.scrollTop).toBe(160);
	});

	it("does not ask the page to reveal the thinking tail", () => {
		const container = document.createElement("div") as HTMLDivElement;
		const contentRoot = document.createElement("div");
		const markdownRoot = document.createElement("div");
		const paragraph = document.createElement("p");
		markdownRoot.className = "markdown-content";
		markdownRoot.appendChild(paragraph);
		contentRoot.appendChild(markdownRoot);
		container.appendChild(contentRoot);
		Object.defineProperty(container, "scrollHeight", { value: 120, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 40, configurable: true });
		paragraph.scrollIntoView = () => {
			throw new Error("thinking follow must not call scrollIntoView");
		};

		scrollTailToVisibleEnd(container);

		expect(container.scrollTop).toBe(80);
	});
});
