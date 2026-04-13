import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createStreamingReveal } from "../create-streaming-reveal.svelte.js";

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

describe("createStreamingReveal", () => {
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

	it("reveals source text over successive animation frames", () => {
		const reveal = createStreamingReveal();

		reveal.setState("Hello world", true);
		expect(reveal.mode).toBe("streaming");
		expect(reveal.displayedText).toBe("");
		expect(queuedFrames.length).toBe(1);

		flushNextFrame(16);
		expect(reveal.displayedText.length).toBeGreaterThan(0);
		expect(reveal.displayedText.length).toBeLessThan("Hello world".length);
	});

	it("keeps reveal active after backend streaming ends until backlog is drained", () => {
		const reveal = createStreamingReveal();

		reveal.setState("Hello world", true);
		flushNextFrame(16);
		const partialLength = reveal.displayedText.length;
		expect(partialLength).toBeGreaterThan(0);
		expect(partialLength).toBeLessThan("Hello world".length);

		reveal.setState("Hello world", false);
		expect(reveal.isRevealActive).toBe(true);
		expect(reveal.mode).toBe("completion-catchup");

		while (queuedFrames.length > 0) {
			flushNextFrame(32);
		}
		expect(reveal.displayedText).toBe("Hello world");
		expect(reveal.mode).toBe("complete");
		expect(reveal.isRevealActive).toBe(false);
	});

	it("resets displayed state between unrelated messages", () => {
		const reveal = createStreamingReveal();

		reveal.setState("First message", true);
		flushNextFrame(16);
		expect(reveal.displayedText.length).toBeGreaterThan(0);
		
		reveal.reset();
		expect(reveal.displayedText).toBe("");
		expect(reveal.mode).toBe("idle");
		expect(reveal.cursorVisible).toBe(false);
		expect(queuedFrames.length).toBe(0);
	});

	it("seeds the first mounted streaming state from the existing source text", () => {
		const reveal = createStreamingReveal();

		reveal.setState("Already streamed text", true, { seedFromSource: true });

		expect(reveal.displayedText).toBe("Already streamed text");
		expect(reveal.mode).toBe("streaming");
		expect(queuedFrames.length).toBe(0);
	});
});
