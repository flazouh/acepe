import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createSmoothStreamingReveal } from "../create-smooth-streaming-reveal.svelte.js";

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

describe("createSmoothStreamingReveal", () => {
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

	it("reveals streaming text in buffered batches after the flush interval", () => {
		const reveal = createSmoothStreamingReveal();
		const text = "a".repeat(320);

		reveal.setState(text, true);
		expect(reveal.displayedText).toBe("");
		expect(reveal.mode).toBe("streaming");
		expect(queuedFrames.length).toBe(1);

		flushNextFrame(16);
		expect(reveal.displayedText).toBe("");

		flushNextFrame(32);
		expect(reveal.displayedText).toBe("");

		flushNextFrame(48);
		expect(reveal.displayedText).toBe("");

		flushNextFrame(64);
		expect(reveal.displayedText.length).toBeGreaterThanOrEqual(80);
		expect(reveal.displayedText.length).toBeLessThan(text.length);
		expect(reveal.isRevealActive).toBe(true);
	});

	it("ignores stale animation frames after reset or destroy", () => {
		const reveal = createSmoothStreamingReveal();
		const text = "b".repeat(240);

		reveal.setState(text, true);
		const staleAfterReset = queuedFrames[0];
		if (!staleAfterReset) {
			throw new Error("Expected queued frame before reset");
		}

		reveal.reset();
		expect(reveal.displayedText).toBe("");
		expect(reveal.mode).toBe("idle");
		expect(queuedFrames.length).toBe(0);

		staleAfterReset.callback(64);
		expect(reveal.displayedText).toBe("");
		expect(reveal.mode).toBe("idle");
		expect(queuedFrames.length).toBe(0);

		reveal.setState(text, true);
		const staleAfterDestroy = queuedFrames[0];
		if (!staleAfterDestroy) {
			throw new Error("Expected queued frame before destroy");
		}

		reveal.destroy();
		expect(queuedFrames.length).toBe(0);

		staleAfterDestroy.callback(128);
		expect(reveal.displayedText).toBe("");
		expect(queuedFrames.length).toBe(0);
	});

	it("drains faster once streaming completes with backlog remaining", () => {
		const reveal = createSmoothStreamingReveal();
		const text = "c".repeat(480);

		reveal.setState(text, true);
		flushNextFrame(16);
		flushNextFrame(32);
		flushNextFrame(48);
		flushNextFrame(64);
		const streamingLength = reveal.displayedText.length;
		expect(streamingLength).toBeGreaterThanOrEqual(80);

		reveal.setState(text, false);
		expect(reveal.mode).toBe("completion-catchup");

		flushNextFrame(80);
		const catchupLength = reveal.displayedText.length;
		expect(catchupLength - streamingLength).toBeGreaterThan(streamingLength);
		expect(catchupLength).toBeLessThanOrEqual(text.length);
	});

	it("enters paused-awaiting-more after catchup finishes while streaming stays open", () => {
		const reveal = createSmoothStreamingReveal();

		reveal.setState("hello", true);
		flushNextFrame(16);
		flushNextFrame(32);
		flushNextFrame(48);
		flushNextFrame(64);
		expect(reveal.displayedText).toBe("hello");
		expect(reveal.mode).toBe("streaming");
		expect(reveal.isRevealActive).toBe(false);
		expect(queuedFrames.length).toBe(1);

		flushNextFrame(196);
		expect(reveal.mode).toBe("paused-awaiting-more");
		expect(reveal.isRevealActive).toBe(false);
		expect(queuedFrames.length).toBe(0);
	});

	it("resumes reveal after entering paused-awaiting-more when new text arrives", () => {
		const reveal = createSmoothStreamingReveal();

		reveal.setState("hello", true);
		flushNextFrame(16);
		flushNextFrame(32);
		flushNextFrame(48);
		flushNextFrame(64);
		expect(reveal.displayedText).toBe("hello");
		expect(reveal.isRevealActive).toBe(false);

		flushNextFrame(196);
		expect(reveal.mode).toBe("paused-awaiting-more");
		expect(queuedFrames.length).toBe(0);

		reveal.setState("hello world", true);
		expect(reveal.mode).toBe("streaming");
		expect(reveal.isRevealActive).toBe(true);
		expect(queuedFrames.length).toBe(1);

		flushNextFrame(212);
		flushNextFrame(228);
		flushNextFrame(244);
		flushNextFrame(260);
		expect(reveal.displayedText).toBe("hello world");
	});

	it("seeds from source without replaying the existing text", () => {
		const reveal = createSmoothStreamingReveal();

		reveal.setState("Already streamed text", true, { seedFromSource: true });

		expect(reveal.displayedText).toBe("Already streamed text");
		expect(reveal.mode).toBe("streaming");
		expect(reveal.isRevealActive).toBe(false);
		expect(queuedFrames.length).toBe(0);
	});

	it("resets reveal progress when the source is replaced instead of appended", () => {
		const reveal = createSmoothStreamingReveal();

		reveal.setState("d".repeat(240), true);
		flushNextFrame(16);
		flushNextFrame(32);
		flushNextFrame(48);
		flushNextFrame(64);
		expect(reveal.displayedText.length).toBeGreaterThan(0);

		reveal.setState("replacement", true);
		expect(reveal.displayedText).toBe("");
		expect(reveal.mode).toBe("streaming");
		expect(reveal.isRevealActive).toBe(true);
		expect(queuedFrames.length).toBe(1);
	});
});
