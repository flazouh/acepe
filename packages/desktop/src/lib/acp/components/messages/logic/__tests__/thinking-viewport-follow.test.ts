import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
	createRafDedupeScheduler,
	resolveTailTarget,
	scrollTailToVisibleEnd,
} from "../thinking-viewport-follow.js";

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

describe("resolveTailTarget", () => {
	it("returns the last .markdown-content child across multiple markdown roots", () => {
		const root = document.createElement("div");
		const md1 = document.createElement("div");
		md1.className = "markdown-content";
		const p1 = document.createElement("p");
		const p2 = document.createElement("p");
		md1.appendChild(p1);
		md1.appendChild(p2);
		const md2 = document.createElement("div");
		md2.className = "markdown-content";
		const p3 = document.createElement("p");
		md2.appendChild(p3);
		root.appendChild(md1);
		root.appendChild(md2);

		expect(resolveTailTarget(root)).toBe(p3);
	});

	it("falls back to lastElementChild when no markdown blocks", () => {
		const root = document.createElement("div");
		const div = document.createElement("div");
		root.appendChild(div);
		expect(resolveTailTarget(root)).toBe(div);
	});

	it("returns null for empty root", () => {
		const root = document.createElement("div");
		expect(resolveTailTarget(root)).toBeNull();
	});
});

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

		scrollTailToVisibleEnd(container, undefined);
		expect(container.scrollTop).toBe(160);
	});
});
