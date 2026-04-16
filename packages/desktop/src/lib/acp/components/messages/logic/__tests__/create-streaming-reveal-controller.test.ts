import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
	CSS_DRAIN_TIMEOUT_MS,
	createStreamingRevealController,
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

	it("surfaces the full source text immediately while streaming", () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello world", true);

		expect(controller.displayedText).toBe("Hello world");
		expect(controller.mode).toBe("streaming");
		expect(controller.isRevealActive).toBe(true);
	});

	it("keeps displayedText in sync as streaming text grows rapidly", () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello", true);
		expect(controller.displayedText).toBe("Hello");

		controller.setState("Hello world", true);
		expect(controller.displayedText).toBe("Hello world");

		controller.setState("Hello world again", true);
		expect(controller.displayedText).toBe("Hello world again");
	});

	it("keeps reveal activity during streaming, then drains before going inactive", async () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello world", true);
		expect(controller.isRevealActive).toBe(true);
		expect(controller.mode).toBe("streaming");

		controller.setState("Hello world", false);
		expect(controller.displayedText).toBe("Hello world");
		expect(controller.mode).toBe("complete");
		expect(controller.isRevealActive).toBe(true);

		await waitForDrain();

		expect(controller.isRevealActive).toBe(false);
	});

	it("skips the drain window in instant mode", () => {
		const controller = createStreamingRevealController("instant");

		controller.setState("Hello world", true);
		expect(controller.isRevealActive).toBe(true);

		controller.setState("Hello world", false);

		expect(controller.mode).toBe("complete");
		expect(controller.isRevealActive).toBe(false);
	});

	it("skips the drain window when reduced motion is enabled", () => {
		motionQueryStub = createMotionQueryStub(true);
		globalThis.matchMedia = () => motionQueryStub;

		const controller = createStreamingRevealController("smooth");
		controller.setState("Hello world", true);
		controller.setState("Hello world", false);

		expect(controller.mode).toBe("complete");
		expect(controller.isRevealActive).toBe(false);
	});

	it("cancels an active drain when mode switches to instant", () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello world", true);
		controller.setState("Hello world", false);
		expect(controller.isRevealActive).toBe(true);

		controller.setMode("instant");

		expect(controller.mode).toBe("complete");
		expect(controller.isRevealActive).toBe(false);
	});

	it("cancels an active drain when reduced motion turns on", () => {
		const controller = createStreamingRevealController("smooth");

		controller.setState("Hello world", true);
		controller.setState("Hello world", false);
		expect(controller.isRevealActive).toBe(true);

		motionQueryStub.emitChange(true);

		expect(controller.mode).toBe("complete");
		expect(controller.isRevealActive).toBe(false);
	});

	it("supports seedFromSource and reset across all modes", () => {
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
