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

function stubMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
	Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
	Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
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
		expect(readScrollMetrics(el)).toEqual({ scrollTop: 250, scrollHeight: 2000, clientHeight: 1000 });
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
		expect(applyScrollAction(el, { kind: "preserveAnchor", deltaPx: 160 })).toBe(true);
		expect(el.scrollTop).toBe(660);
	});

	it("anchorRowNearTop places the row top minus the peek", () => {
		const el = makeScrollEl(2000, 1000);
		const resolveRowTop = (rowId: string) => (rowId === "row-7" ? 900 : null);
		expect(applyScrollAction(el, { kind: "anchorRowNearTop", rowId: "row-7", peekPx: 64 }, resolveRowTop)).toBe(
			true
		);
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

	beforeEach(() => {
		el = makeScrollEl(2000, 1000);
		states = [];
	});

	function controllerFor(extra: Parameters<typeof createStickToBottomController>[1] = {}) {
		return createStickToBottomController(el, {
			onStateChange: (s) => states.push(s),
			...extra,
		});
	}

	it("releases follow on a user scroll away from the bottom", () => {
		const c = controllerFor();
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false });
		c.destroy();
	});

	it("re-engages follow when the user scrolls back to the bottom", () => {
		const c = controllerFor();
		el.scrollTop = 200;
		el.dispatchEvent(new Event("scroll"));
		el.scrollTop = 990;
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false });
		c.destroy();
	});

	it("does not mistake a programmatic scroll for a user scroll-away", () => {
		const resolveRowTop = () => 1000;
		const c = controllerFor({ resolveRowTop });
		// onSend lands the row near the top (936) — a non-bottom position — but is
		// our own scroll, so the resulting scroll event must NOT release follow.
		c.onSend("row-x", 64);
		expect(el.scrollTop).toBe(936);
		el.dispatchEvent(new Event("scroll"));
		expect(c.getState().released).toBe(false);
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
		const resolveRowTop = (rowId: string) => (rowId === "user-latest" ? 860 : null);
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

	it("detaches its scroll listener on destroy", () => {
		const c = controllerFor();
		const removeSpy = vi.spyOn(el, "removeEventListener");
		c.destroy();
		expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
	});
});
