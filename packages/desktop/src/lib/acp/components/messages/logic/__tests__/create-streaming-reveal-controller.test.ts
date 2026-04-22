import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
	CSS_DRAIN_TIMEOUT_MS,
	createStreamingRevealController,
	REVEAL_TICK_MS,
	type StreamingRevealController,
} from "../create-streaming-reveal-controller.svelte.js";

type MotionChangeListener = NonNullable<MediaQueryList["onchange"]>;

type MotionQueryStub = MediaQueryList & {
	emitChange: (matches: boolean) => void;
};

function waitForDrain(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, CSS_DRAIN_TIMEOUT_MS + 20);
	});
}

function waitForRevealTick(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, REVEAL_TICK_MS + 20);
	});
}

function createAndSeedController(mode: "smooth" | "instant"): StreamingRevealController {
	const controller = createStreamingRevealController(mode);
	controller.setState("Already streamed text", true, { seedFromSource: true });
	return controller;
}

function createMotionQueryStub(initialMatches: boolean): MotionQueryStub {
	const listeners = new Set<MotionChangeListener>();
	let currentMatches = initialMatches;

	function addMotionListener(listener: MotionChangeListener | null): void {
		if (listener !== null) {
			listeners.add(listener);
		}
	}

	function removeMotionListener(listener: MotionChangeListener | null): void {
		if (listener !== null) {
			listeners.delete(listener);
		}
	}

	const stub: MotionQueryStub = {
		get matches() {
			return currentMatches;
		},
		media: "(prefers-reduced-motion: reduce)",
		onchange: null,
		addListener(listener: MotionChangeListener | null) {
			addMotionListener(listener);
		},
		removeListener(listener: MotionChangeListener | null) {
			removeMotionListener(listener);
		},
		addEventListener(_type: string, listener: EventListenerOrEventListenerObject | null) {
			if (typeof listener === "function") {
				addMotionListener(listener as MotionChangeListener);
			}
		},
		removeEventListener(_type: string, listener: EventListenerOrEventListenerObject | null) {
			if (typeof listener === "function") {
				removeMotionListener(listener as MotionChangeListener);
			}
		},
		dispatchEvent(_event) {
			return true;
		},
		emitChange(matches) {
			currentMatches = matches;
			const event = { matches } as MediaQueryListEvent;
			for (const listener of listeners) {
				listener.call(stub, event);
			}
		},
	};

	return stub;
}

const originalMatchMedia = globalThis.matchMedia;
let motionQueryStub = createMotionQueryStub(false);

describe("createStreamingRevealController", () => {
	beforeEach(() => {
		motionQueryStub = createMotionQueryStub(false);
		globalThis.matchMedia = () => motionQueryStub;
	});

	afterEach(() => {
		globalThis.matchMedia = originalMatchMedia;
	});

	it("paces displayedText instead of surfacing the full source immediately while streaming", async () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello world", true);

		expect(controller.displayedText).toBe("");
		expect(controller.mode).toBe("streaming");
		expect(controller.isRevealActive).toBe(true);

		await waitForRevealTick();

		expect(controller.displayedText.length).toBeGreaterThan(0);
		expect(controller.displayedText.length).toBeLessThan("Hello world".length);
		expect("Hello world".startsWith(controller.displayedText)).toBe(true);
	});

	it("continues revealing more text across ticks as streaming text grows", async () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello world again", true);
		await waitForRevealTick();
		const firstTickText = controller.displayedText;

		controller.setState("Hello world again and again", true);
		await waitForRevealTick();

		expect(controller.displayedText.length).toBeGreaterThan(firstTickText.length);
		expect("Hello world again and again".startsWith(controller.displayedText)).toBe(true);
	});

	it("catches up after streaming stops, then drains before going inactive", async () => {
		const controller = createStreamingRevealController("smooth");
		const text = "Hello world from Acepe";

		controller.setState(text, true);
		await waitForRevealTick();
		expect(controller.displayedText.length).toBeLessThan(text.length);

		controller.setState(text, false);
		expect(controller.mode).toBe("completion-catchup");
		expect(controller.isRevealActive).toBe(true);

		for (let index = 0; index < 8 && controller.displayedText !== text; index += 1) {
			await waitForRevealTick();
		}

		expect(controller.displayedText).toBe(text);
		expect(controller.mode).toBe("complete");
		expect(controller.isRevealActive).toBe(true);

		await waitForDrain();

		expect(controller.isRevealActive).toBe(false);
	});

	it("snaps to full text immediately when reduced motion is enabled", () => {
		motionQueryStub = createMotionQueryStub(true);
		globalThis.matchMedia = () => motionQueryStub;

		const controller = createStreamingRevealController("smooth");
		controller.setState("Hello world", true);

		expect(controller.displayedText).toBe("Hello world");
		expect(controller.mode).toBe("paused-awaiting-more");
		expect(controller.isRevealActive).toBe(true);
	});

	it("supports seedFromSource and reset across compatibility values", () => {
		const smooth = createAndSeedController("smooth");
		const instant = createAndSeedController("instant");

		expect(smooth.displayedText).toBe("Already streamed text");
		expect(instant.displayedText).toBe("Already streamed text");

		smooth.reset();
		instant.reset();

		expect(smooth.displayedText).toBe("");
		expect(instant.displayedText).toBe("");
		expect(smooth.mode).toBe("idle");
		expect(instant.mode).toBe("idle");
	});

	it("returns to idle cleanly when streaming ends with empty text", () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("", true);
		expect(controller.mode).toBe("streaming");
		expect(controller.isRevealActive).toBe(true);

		controller.setState("", false);

		expect(controller.displayedText).toBe("");
		expect(controller.mode).toBe("idle");
		expect(controller.isRevealActive).toBe(false);
	});
});
