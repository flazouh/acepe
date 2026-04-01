import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { ScrollPositionProvider } from "../create-auto-scroll.svelte.js";

import {
	AutoScrollLogic,
	canNestedScrollableConsumeWheel,
	createAutoScroll,
} from "../create-auto-scroll.svelte.js";

/**
 * Creates a mock ScrollPositionProvider with configurable scroll state.
 */
function createMockProvider(
	options: { scrollSize?: number; viewportSize?: number; scrollOffset?: number } = {}
): ScrollPositionProvider & {
	_setScrollOffset: (offset: number) => void;
	_setScrollSize: (size: number) => void;
	scrollToIndex: ReturnType<typeof mock>;
} {
	const state = {
		scrollSize: options.scrollSize ?? 1000,
		viewportSize: options.viewportSize ?? 500,
		scrollOffset: options.scrollOffset ?? 0,
	};

	const scrollToIndex = mock(() => {});

	return {
		getScrollSize: () => state.scrollSize,
		getViewportSize: () => state.viewportSize,
		getScrollOffset: () => state.scrollOffset,
		scrollToIndex,
		_setScrollOffset: (offset: number) => {
			state.scrollOffset = offset;
		},
		_setScrollSize: (size: number) => {
			state.scrollSize = size;
		},
	};
}

describe("AutoScrollLogic", () => {
	let logic: AutoScrollLogic;
	let mockProvider: ReturnType<typeof createMockProvider>;

	beforeEach(() => {
		logic = new AutoScrollLogic();
		mockProvider = createMockProvider();
		logic.setProvider(mockProvider);
		logic.setItemCount(10);
	});

	describe("initial state", () => {
		it("starts following", () => {
			expect(logic.following).toBe(true);
		});

		it("has no effect when provider is not set", () => {
			const freshLogic = new AutoScrollLogic();
			expect(freshLogic.revealLatest()).toBe(false);
			expect(freshLogic.following).toBe(true);
		});

		it("is safe to call all methods after provider is cleared", () => {
			// Do some work with a provider (simulate active scrolling)
			logic.revealLatest();
			mockProvider._setScrollOffset(500);
			logic.handleScroll();

			// Clear provider (simulates unmount cleanup)
			logic.setProvider(undefined);

			// All methods should return safe defaults without throwing
			expect(logic.revealLatest()).toBe(false);
			expect(logic.isNearBottom()).toBe(true);
			logic.handleScroll();
			expect(logic.following).toBe(true);
		});
	});

	describe("isNearBottom", () => {
		it("returns true when within threshold (10px)", () => {
			// scrollSize=1000, viewportSize=500, offset=495 → distance=5
			mockProvider._setScrollOffset(495);
			expect(logic.isNearBottom()).toBe(true);
		});

		it("returns false when outside threshold", () => {
			mockProvider._setScrollOffset(200);
			expect(logic.isNearBottom()).toBe(false);
		});

		it("returns true when exactly at bottom", () => {
			mockProvider._setScrollOffset(500);
			expect(logic.isNearBottom()).toBe(true);
		});

		it("returns true when no provider", () => {
			logic.setProvider(undefined);
			expect(logic.isNearBottom()).toBe(true);
		});
	});

	describe("revealLatest", () => {
		it("reveals when following", () => {
			const result = logic.revealLatest();
			expect(result).toBe(true);
			expect(mockProvider.scrollToIndex).toHaveBeenCalledWith(9, { align: "end" });
		});

		it("does not reveal when detached", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			const result = logic.revealLatest();
			expect(result).toBe(false);
			expect(mockProvider.scrollToIndex).not.toHaveBeenCalled();
		});

		it("reveals when force=true even if detached", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			const result = logic.revealLatest(true);
			expect(result).toBe(true);
			expect(mockProvider.scrollToIndex).toHaveBeenCalledWith(9, { align: "end" });
			expect(logic.following).toBe(true);
		});

		it("does not scroll when already at bottom", () => {
			mockProvider._setScrollOffset(500);
			const result = logic.revealLatest();
			expect(result).toBe(false);
			expect(mockProvider.scrollToIndex).not.toHaveBeenCalled();
		});

		it("does not scroll when content fits in viewport", () => {
			const smallContent = createMockProvider({
				scrollSize: 400,
				viewportSize: 500,
			});
			logic.setProvider(smallContent);
			const result = logic.revealLatest();
			expect(result).toBe(false);
			expect(smallContent.scrollToIndex).not.toHaveBeenCalled();
		});

		it("stays detached without force when user has control", () => {
			const smallContent = createMockProvider({
				scrollSize: 400,
				viewportSize: 500,
			});
			logic.setProvider(smallContent);

			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			const result = logic.revealLatest();
			expect(result).toBe(false);
			expect(logic.following).toBe(false);
		});

		it("handles itemCount of 0", () => {
			logic.setItemCount(0);
			const result = logic.revealLatest();
			expect(result).toBe(false);
		});
	});

	describe("isAuto (programmatic scroll detection)", () => {
		it("returns true immediately after revealLatest", () => {
			logic.revealLatest();
			// Position the mock at the expected bottom
			mockProvider._setScrollOffset(500);
			expect(logic.isAuto()).toBe(true);
		});

		it("returns false when position doesn't match (user scrolled)", () => {
			logic.revealLatest();
			// Position is NOT at the expected bottom (user scrolled elsewhere)
			mockProvider._setScrollOffset(200);
			expect(logic.isAuto()).toBe(false);
		});

		it("returns false when no recent revealLatest call", () => {
			expect(logic.isAuto()).toBe(false);
		});

		it("expires after suppression timeout", async () => {
			logic.revealLatest();
			mockProvider._setScrollOffset(500);
			expect(logic.isAuto()).toBe(true);

			// Wait for timeout to expire
			await new Promise((resolve) => setTimeout(resolve, 450));
			expect(logic.isAuto()).toBe(false);
		});

		it("treats larger bottom-offset drift as auto while suppression is active", () => {
			logic.revealLatest();
			// Expected offset is 500 (scrollSize=1000 - viewportSize=500)
			mockProvider._setScrollOffset(499); // 1px off
			expect(logic.isAuto()).toBe(true);

			mockProvider._setScrollOffset(470); // 30px off old bottom target
			expect(logic.isAuto()).toBe(true);

			mockProvider._setScrollOffset(450); // 50px off old bottom target
			expect(logic.isAuto()).toBe(false);
		});

		it("is cleared on reset", () => {
			logic.revealLatest();
			mockProvider._setScrollOffset(500);
			expect(logic.isAuto()).toBe(true);

			logic.reset();
			expect(logic.isAuto()).toBe(false);
		});
	});

	describe("handleWheelIntent", () => {
		it("detaches when scrolling up (negative deltaY)", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);
		});

		it("detaches on scroll down when away from bottom (respect manual scroll)", () => {
			mockProvider._setScrollOffset(100); // far from bottom
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(false);
		});

		it("does not detach on scroll down when already near bottom", () => {
			mockProvider._setScrollOffset(495); // near bottom
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(true);
		});

		it("re-engages when scrolling down near bottom", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			mockProvider._setScrollOffset(495); // near bottom
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(true);
		});

		it("does not re-engage when scrolling down but far from bottom", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			mockProvider._setScrollOffset(100); // far from bottom
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(false);
		});

		it("ignores scroll on nested scrollable elements", () => {
			logic.handleWheelIntent(-100, true);
			expect(logic.following).toBe(true);
		});

		it("only sets flag once (idempotent)", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			logic.handleWheelIntent(-200, false);
			expect(logic.following).toBe(false);
		});
	});

	describe("handleScroll", () => {
		it("detaches when user scrolls away from bottom", () => {
			mockProvider._setScrollOffset(100); // Far from bottom
			logic.handleScroll();
			expect(logic.following).toBe(false);
		});

		it("stays following when near bottom", () => {
			mockProvider._setScrollOffset(495); // distance = 5px (within 10px threshold)
			logic.handleScroll();
			expect(logic.following).toBe(true);
		});

		it("stays following during programmatic scroll (isAuto)", () => {
			logic.revealLatest(); // marks auto
			// Simulate scroll event at the expected position
			mockProvider._setScrollOffset(500);
			// isAuto returns true, so handleScroll ignores this
			logic.handleScroll();
			expect(logic.following).toBe(true);
		});

		it("isAuto guard works even when detached (force scroll)", () => {
			// User detaches
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			// Force scroll (e.g., new user message) — marks auto
			logic.revealLatest(true);
			expect(logic.following).toBe(true);

			// Scroll event fires at expected bottom position
			mockProvider._setScrollOffset(500);
			logic.handleScroll();
			// isAuto() should catch this, preventing false detach
			expect(logic.following).toBe(true);
		});

		it("does not re-engage via handleScroll even when near bottom", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			mockProvider._setScrollOffset(495); // near bottom
			logic.handleScroll();
			// handleScroll never re-engages — only handleWheelIntent does
			expect(logic.following).toBe(false);
		});

		it("re-attaches when content no longer scrolls", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			const smallContent = createMockProvider({
				scrollSize: 400,
				viewportSize: 500,
				scrollOffset: 0,
			});
			logic.setProvider(smallContent);
			logic.handleScroll();
			expect(logic.following).toBe(true);
		});
	});

	describe("reset", () => {
		it("resets to following state", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			logic.reset();
			expect(logic.following).toBe(true);
		});

		it("clears auto mark", () => {
			logic.revealLatest();
			mockProvider._setScrollOffset(500);
			expect(logic.isAuto()).toBe(true);

			logic.reset();
			expect(logic.isAuto()).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("handles rapid scroll up then return to bottom via wheel", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			// Scroll down far from bottom — stays detached
			mockProvider._setScrollOffset(200);
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(false);

			// Scroll down near bottom — re-engages
			mockProvider._setScrollOffset(495);
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(true);
		});

		it("stays following when content size grows while the thread is anchored", () => {
			// Start at bottom
			mockProvider._setScrollOffset(500);
			logic.handleScroll();
			expect(logic.following).toBe(true);

			// Content grows - now we're far from bottom
			mockProvider._setScrollSize(2000);
			// distance = 2000 - (500 + 500) = 1000px
			logic.handleScroll();
			expect(logic.following).toBe(true);
		});

		it("stays detached when content keeps growing after the user scrolls away", () => {
			mockProvider._setScrollOffset(100);
			logic.handleScroll();
			expect(logic.following).toBe(false);

			mockProvider._setScrollSize(2000);
			logic.handleScroll();
			expect(logic.following).toBe(false);
		});

		it("handles exactly at threshold boundary via wheel re-engage", () => {
			logic.handleWheelIntent(-100, false);

			// Exactly at threshold (10px from bottom) — NOT near enough
			mockProvider._setScrollOffset(490); // distance = 10px
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(false);

			// Just inside threshold (9px from bottom) — near enough
			mockProvider._setScrollOffset(491); // distance = 9px
			logic.handleWheelIntent(100, false);
			expect(logic.following).toBe(true);
		});
	});

	describe("programmatic scroll suppression for virtualized settling", () => {
		it("does not falsely detach when bottom offset drifts after programmatic scroll", () => {
			mockProvider._setScrollOffset(100);
			logic.revealLatest();

			// Simulate virtualized content remeasurement growing after scrollToBottom().
			mockProvider._setScrollOffset(500);
			mockProvider._setScrollSize(2000);

			logic.handleScroll();

			expect(logic.following).toBe(true);
		});

		it("still detaches for a real user scroll away during suppression window", () => {
			mockProvider._setScrollOffset(100);
			logic.revealLatest();

			// User scrolls away from the previously pinned bottom.
			mockProvider._setScrollOffset(200);
			logic.handleScroll();

			expect(logic.following).toBe(false);
		});

		it("isNearBottom is geometry-based and independent from follow state", () => {
			logic.handleWheelIntent(-100, false);
			expect(logic.following).toBe(false);

			mockProvider._setScrollOffset(495);
			expect(logic.isNearBottom()).toBe(true);
		});
	});

	describe("canNestedScrollableConsumeWheel", () => {
		it("returns false when the nested scrollable is already at the top", () => {
			expect(
				canNestedScrollableConsumeWheel({
					scrollTop: 0,
					scrollHeight: 500,
					clientHeight: 200,
					deltaY: -80,
				})
			).toBe(false);
		});

		it("returns false when the nested scrollable is already at the bottom", () => {
			expect(
				canNestedScrollableConsumeWheel({
					scrollTop: 300,
					scrollHeight: 500,
					clientHeight: 200,
					deltaY: 80,
				})
			).toBe(false);
		});

		it("returns true when the nested scrollable can still consume the wheel delta", () => {
			expect(
				canNestedScrollableConsumeWheel({
					scrollTop: 120,
					scrollHeight: 500,
					clientHeight: 200,
					deltaY: 80,
				})
			).toBe(true);
		});
	});
});

describe("createAutoScroll", () => {
	const originalRAF = globalThis.requestAnimationFrame;
	const originalCancelRAF = globalThis.cancelAnimationFrame;
	let queuedAnimationFrames: Array<{ id: number; callback: FrameRequestCallback }> = [];
	let nextAnimationFrameId = 1;

	beforeEach(() => {
		queuedAnimationFrames = [];
		nextAnimationFrameId = 1;
		globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			queuedAnimationFrames.push({ id, callback });
			return id;
		};
		globalThis.cancelAnimationFrame = (id: number) => {
			queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
		};
	});

	afterEach(() => {
		globalThis.requestAnimationFrame = originalRAF;
		globalThis.cancelAnimationFrame = originalCancelRAF;
	});

	it("coalesces rapid scroll events into one geometry measurement pass per frame", () => {
		const provider = {
			getScrollSize: mock(() => 1000),
			getViewportSize: mock(() => 500),
			getScrollOffset: mock(() => 100),
			scrollToIndex: mock(() => {}),
		};

		const autoScroll = createAutoScroll();
		autoScroll.setVListRef(provider);

		provider.getScrollSize.mockClear();
		provider.getViewportSize.mockClear();
		provider.getScrollOffset.mockClear();

		autoScroll.handleScroll();
		autoScroll.handleScroll();
		autoScroll.handleScroll();

		expect(provider.getScrollSize).toHaveBeenCalledTimes(0);
		expect(provider.getViewportSize).toHaveBeenCalledTimes(0);
		expect(provider.getScrollOffset).toHaveBeenCalledTimes(0);

		const queued = [...queuedAnimationFrames];
		queuedAnimationFrames = [];
		for (const frame of queued) {
			frame.callback(0);
		}

		expect(provider.getScrollSize).toHaveBeenCalledTimes(1);
		expect(provider.getViewportSize).toHaveBeenCalledTimes(1);
		expect(provider.getScrollOffset).toHaveBeenCalledTimes(1);
		expect(autoScroll.following).toBe(false);
		expect(autoScroll.nearBottom).toBe(false);
	});
});
