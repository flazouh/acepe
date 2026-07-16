import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StickState } from "./stick-to-bottom.js";
import {
	applyScrollAction,
	createStickToBottomController,
	readScrollMetrics,
} from "./stick-to-bottom-effects.js";

// Unit 1 effects — DOM wiring of the pure stick-to-bottom controller. happy-dom
// has no layout engine, so scrollHeight/clientHeight are stubbed and content
// resize is driven manually via notifyContentChanged() (the path the internal
// ResizeObserver also takes). scrollTop is a writable property here.

function stubMetrics(
	el: HTMLElement,
	scrollHeight: number,
	clientHeight: number,
): void {
	Object.defineProperty(el, "scrollHeight", {
		value: scrollHeight,
		configurable: true,
	});
	Object.defineProperty(el, "clientHeight", {
		value: clientHeight,
		configurable: true,
	});
}

function makeScrollEl(scrollHeight: number, clientHeight: number): HTMLElement {
	const el = document.createElement("div");
	stubMetrics(el, scrollHeight, clientHeight);
	el.scrollTop = 0;
	return el;
}

describe("readScrollMetrics", () => {
	it("reads the same-frame geometry", () => {
		const el = makeScrollEl(2000, 1000);
		el.scrollTop = 250;
		expect(readScrollMetrics(el)).toEqual({
			scrollTop: 250,
			scrollHeight: 2000,
			clientHeight: 1000,
		});
	});
});

describe("applyScrollAction", () => {
	it("toBottom pins to max scrollTop", () => {
		const el = makeScrollEl(2000, 1000);
		expect(applyScrollAction(el, { kind: "toBottom" })).toBe(true);
		expect(el.scrollTop).toBe(1000);
	});

	it("preserveAnchor shifts scrollTop by the delta", () => {
		const el = makeScrollEl(2000, 1000);
		el.scrollTop = 500;
		expect(
			applyScrollAction(el, { kind: "preserveAnchor", deltaPx: 160 }),
		).toBe(true);
		expect(el.scrollTop).toBe(660);
	});

	it("anchorRowNearTop places the row top minus the peek", () => {
		const el = makeScrollEl(2000, 1000);
		const resolveRowTop = (rowId: string) => (rowId === "row-7" ? 900 : null);
		expect(
			applyScrollAction(
				el,
				{ kind: "anchorRowNearTop", rowId: "row-7", peekPx: 64 },
				resolveRowTop,
			),
		).toBe(true);
		expect(el.scrollTop).toBe(836);
	});

	it("none leaves scrollTop untouched", () => {
		const el = makeScrollEl(2000, 1000);
		el.scrollTop = 300;
		expect(applyScrollAction(el, { kind: "none" })).toBe(false);
		expect(el.scrollTop).toBe(300);
	});
});

describe("createStickToBottomController", () => {
	let el: HTMLElement;
	let states: StickState[];
	const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
	const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

	beforeEach(() => {
		el = makeScrollEl(2000, 1000);
		states = [];
		Object.defineProperty(globalThis, "requestAnimationFrame", {
			configurable: true,
			value: originalRequestAnimationFrame,
		});
		Object.defineProperty(globalThis, "cancelAnimationFrame", {
			configurable: true,
			value: originalCancelAnimationFrame,
		});
	});

	function controllerFor(
		extra: Parameters<typeof createStickToBottomController>[1] = {},
	) {
		return createStickToBottomController(el, {
			onStateChange: (s) => states.push(s),
			...extra,
		});
	}

	it("releases follow on a user scroll (wheel) away from the bottom", () => {
		const c = controllerFor();
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 })); // user intent
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false });
		c.destroy();
	});

	it("releases on upward wheel intent before virtualized paging changes content", () => {
		const anchor = { rowId: "a", topPx: 1200 };
		const c = controllerFor({ resolveAnchor: () => anchor });
		el.scrollTop = 1000; // at bottom for the initial 2000px content

		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		stubMetrics(el, 2400, 1000);
		c.notifyContentChanged();

		expect(c.getState().released).toBe(true);
		expect(el.scrollTop).toBe(1000);
		c.destroy();
	});

	it("releases content changes at bottom while upward wheel intent is active", () => {
		const c = controllerFor();
		el.scrollTop = 1000; // at bottom for the initial 2000px content

		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.dispatchEvent(new Event("scroll")); // at-bottom geometry may re-engage follow
		expect(c.getState().released).toBe(true);

		c.notifyContentChanged();

		expect(c.getState().released).toBe(true);
		c.destroy();
	});

	it("keeps upward scroll released when virtualized content changes after a slow frame", () => {
		let timeMs = 0;
		const c = controllerFor({ now: () => timeMs });
		el.scrollTop = 1000; // at bottom for the initial 2000px content

		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.dispatchEvent(new Event("scroll")); // at-bottom geometry may re-engage follow
		timeMs = 300;
		stubMetrics(el, 2400, 1000);
		c.notifyContentChanged();

		expect(c.getState().released).toBe(true);
		expect(el.scrollTop).toBe(1000);
		c.destroy();
	});

	it("releases before content change when coalesced scroll handling has not run yet", () => {
		const anchor = { rowId: "a", topPx: 900 };
		const c = controllerFor({
			resolveAnchor: () => anchor,
			coalesceScrollHandling: true,
		});
		el.scrollTop = 1000; // at bottom for the initial 2000px content

		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.scrollTop = 700;
		stubMetrics(el, 2400, 1000);
		c.notifyContentChanged();

		expect(c.getState().released).toBe(true);
		expect(el.scrollTop).toBe(700);
		c.destroy();
	});

	it("does NOT release on a layout-driven scroll with no user intent (the bug)", () => {
		const c = controllerFor();
		// No wheel/touch/key — e.g. content-visibility estimate→real or placeholder
		// collapse moved scrollTop. Follow must survive.
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("does NOT release during the settle window after our own programmatic pins (burst)", () => {
		const c = controllerFor();
		// Simulate a pin burst: content grows repeatedly while following.
		stubMetrics(el, 2400, 1000);
		c.notifyContentChanged();
		stubMetrics(el, 2800, 1000);
		c.notifyContentChanged();
		// A trailing layout scroll lands not-at-bottom right after the pins.
		el.scrollTop = 1200;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState().released).toBe(false);
		c.destroy();
	});

	it("re-engages follow when the user scrolls back to the bottom", () => {
		const c = controllerFor();
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState().released).toBe(true);
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: 200 }));
		el.scrollTop = 990;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("does not mistake a programmatic scroll for a user scroll-away", () => {
		const resolveRowTop = () => 1000;
		const c = controllerFor({ resolveRowTop });
		c.onSend();
		expect(el.scrollTop).toBe(1000);
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState().released).toBe(false);
		c.destroy();
	});

	it("lets touch scrolling release immediately after the send pin", () => {
		const timeMs = 0;
		const c = controllerFor({ now: () => timeMs });
		c.onSend();
		expect(el.scrollTop).toBe(1000);

		el.dispatchEvent(new Event("touchstart"));
		el.scrollTop = 700;
		el.dispatchEvent(new Event("scroll"));

		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false });
		expect(el.scrollTop).toBe(700);
		c.destroy();
	});

	it("lets a scrollbar drag release immediately after the send pin", () => {
		const timeMs = 0;
		Object.defineProperty(el, "clientWidth", {
			value: 980,
			configurable: true,
		});
		const c = controllerFor({ now: () => timeMs });
		c.onSend();
		expect(el.scrollTop).toBe(1000);

		const pointerDown = new Event("pointerdown");
		Object.defineProperty(pointerDown, "offsetX", {
			value: 990,
			configurable: true,
		});
		el.dispatchEvent(pointerDown);
		el.scrollTop = 700;
		el.dispatchEvent(new Event("scroll"));

		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false });
		expect(el.scrollTop).toBe(700);
		c.destroy();
	});

	it("onSend follows the ordinary bottom without adding temporary scroll geometry", () => {
		let baseScrollHeight = 2100;
		Object.defineProperty(el, "scrollHeight", {
			get: () => baseScrollHeight,
			configurable: true,
		});
		Object.defineProperty(el, "clientHeight", {
			value: 1000,
			configurable: true,
		});
		const c = controllerFor();

		c.onSend();

		expect(el.scrollTop).toBe(1100);

		baseScrollHeight = 2300;
		c.notifyContentChanged();
		expect(el.scrollTop).toBe(1300);
		c.destroy();
	});

	it("following + content SHRINK re-pins to the new bottom (no strand)", () => {
		// A streaming/thinking row collapsing or a content-visibility re-measure can
		// shrink scrollHeight. While following, the view must re-pin to the new
		// bottom, never strand above it.
		const c = controllerFor();
		stubMetrics(el, 2000, 1000);
		el.scrollTop = 1000; // at bottom
		stubMetrics(el, 1400, 1000); // content shrank by 600
		c.notifyContentChanged();
		expect(el.scrollTop).toBe(400); // new maxScrollTop
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("following + content growth pins to the new bottom", () => {
		const c = controllerFor();
		stubMetrics(el, 2400, 1000);
		c.notifyContentChanged();
		expect(el.scrollTop).toBe(1400);
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("released + content appended below flags unread without moving the view", () => {
		const anchor = { rowId: "a", topPx: 600 };
		const c = controllerFor({ resolveAnchor: () => anchor });
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.scrollTop = 500;
		el.dispatchEvent(new Event("scroll")); // release + capture anchor baseline 600
		stubMetrics(el, 2200, 1000); // grew 200 below; anchor unmoved
		c.notifyContentChanged();
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: true });
		expect(el.scrollTop).toBe(500); // anchor delta 0 → no scroll move
		c.destroy();
	});

	it("released + rows above re-measure preserves the anchor without flagging unread", () => {
		const anchor = { rowId: "a", topPx: 600 };
		const c = controllerFor({ resolveAnchor: () => anchor });
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.scrollTop = 500;
		el.dispatchEvent(new Event("scroll")); // release + baseline 600
		anchor.topPx = 760; // row above grew → anchor pushed down 160
		stubMetrics(el, 2160, 1000); // total grew exactly the 160 above
		c.notifyContentChanged();
		expect(el.scrollTop).toBe(660); // +160 keeps the tracked row stationary
		expect(c.getState().hasUnreadBelow).toBe(false);
		c.destroy();
	});

	it("jumpToLatest re-pins to the bottom and clears unread", () => {
		const anchor = { rowId: "a", topPx: 600 };
		const c = controllerFor({ resolveAnchor: () => anchor });
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		stubMetrics(el, 2200, 1000);
		c.notifyContentChanged(); // unread now true
		c.jumpToLatest();
		expect(el.scrollTop).toBe(1200);
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("openAt anchors a saved thread row near the top and leaves follow released", () => {
		const resolveRowTop = (rowId: string) =>
			rowId === "user-latest" ? 860 : null;
		const c = controllerFor({ resolveRowTop });
		c.openAt("user-latest", 72);
		expect(el.scrollTop).toBe(788);
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false });
		c.destroy();
	});

	it("openAt falls back to the live edge when the requested row is not mounted", () => {
		const c = controllerFor({ resolveRowTop: () => null });
		c.openAt("missing-row", 72);
		expect(el.scrollTop).toBe(1000);
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("deduplicates edge state notifications during scrolling", () => {
		const edges: Array<{ atTop: boolean; atBottom: boolean }> = [];
		const c = controllerFor({
			onEdgeStateChange: (state) => edges.push(state),
		});

		el.scrollTop = 100;
		el.dispatchEvent(new Event("scroll"));
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		el.scrollTop = 1000;
		el.dispatchEvent(new Event("scroll"));

		expect(edges).toEqual([
			{ atTop: true, atBottom: false },
			{ atTop: false, atBottom: false },
			{ atTop: false, atBottom: true },
		]);
		c.destroy();
	});

	it("coalesces scroll handling to one frame when requested", () => {
		const edges: Array<{ atTop: boolean; atBottom: boolean }> = [];
		const callbacks: FrameRequestCallback[] = [];
		Object.defineProperty(globalThis, "requestAnimationFrame", {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				callbacks.push(callback);
				return callbacks.length;
			},
		});
		Object.defineProperty(globalThis, "cancelAnimationFrame", {
			configurable: true,
			value: () => {},
		});
		const c = controllerFor({
			coalesceScrollHandling: true,
			onEdgeStateChange: (state) => edges.push(state),
		});

		el.scrollTop = 100;
		el.dispatchEvent(new Event("scroll"));
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));

		expect(callbacks).toHaveLength(1);
		expect(edges).toEqual([{ atTop: true, atBottom: false }]);

		callbacks[0]?.(0);

		expect(edges).toEqual([
			{ atTop: true, atBottom: false },
			{ atTop: false, atBottom: false },
		]);
		c.destroy();
	});

	it("uses injected scroll metrics for coalesced scroll handling", () => {
		const edges: Array<{ atTop: boolean; atBottom: boolean }> = [];
		const callbacks: FrameRequestCallback[] = [];
		let scrollHeightReads = 0;
		let clientHeightReads = 0;
		const metrics = {
			scrollTop: 0,
			scrollHeight: 3_000,
			clientHeight: 1_000,
		};
		Object.defineProperty(el, "scrollHeight", {
			get: () => {
				scrollHeightReads += 1;
				return 2_000;
			},
			configurable: true,
		});
		Object.defineProperty(el, "clientHeight", {
			get: () => {
				clientHeightReads += 1;
				return 1_000;
			},
			configurable: true,
		});
		Object.defineProperty(globalThis, "requestAnimationFrame", {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				callbacks.push(callback);
				return callbacks.length;
			},
		});
		Object.defineProperty(globalThis, "cancelAnimationFrame", {
			configurable: true,
			value: () => {},
		});
		const c = controllerFor({
			coalesceScrollHandling: true,
			readScrollMetrics: () => metrics,
			onEdgeStateChange: (state) => edges.push(state),
		});

		scrollHeightReads = 0;
		clientHeightReads = 0;
		el.scrollTop = 400;
		metrics.scrollTop = 400;
		el.dispatchEvent(new Event("scroll"));
		callbacks[0]?.(0);

		expect(scrollHeightReads).toBe(0);
		expect(clientHeightReads).toBe(0);
		expect(edges).toEqual([
			{ atTop: true, atBottom: false },
			{ atTop: false, atBottom: false },
		]);
		c.destroy();
	});

	it("detaches its scroll listener on destroy", () => {
		const c = controllerFor();
		const removeSpy = vi.spyOn(el, "removeEventListener");
		c.destroy();
		expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
	});
});
