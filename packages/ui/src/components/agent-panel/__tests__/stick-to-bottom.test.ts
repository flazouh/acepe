import { describe, expect, test } from "bun:test";
import {
	DEFAULT_AT_BOTTOM_THRESHOLD_PX,
	anchorCorrectionPx,
	computeSendAnchorSpacerPx,
	initialStickState,
	isAtBottom,
	jumpToLatest,
	onContentChange,
	onScrollMeasure,
	onSend,
	shouldReleaseOnUserScroll,
} from "../stick-to-bottom.js";

// Unit 1 — pure stick-to-bottom controller (no DOM). Proves the arithmetic and
// the follow/release/unread transitions. Layout/paint behaviour is dev-app QA.

describe("isAtBottom", () => {
	test("true when distance from bottom is within threshold", () => {
		expect(isAtBottom({ scrollTop: 980, scrollHeight: 2000, clientHeight: 1000 })).toBe(true); // dist 20 <= 24
	});

	test("false when scrolled above the threshold", () => {
		expect(isAtBottom({ scrollTop: 900, scrollHeight: 2000, clientHeight: 1000 })).toBe(false); // dist 100
	});

	test("boundary: exactly at threshold counts as at-bottom", () => {
		expect(
			isAtBottom({
				scrollTop: 1000 - DEFAULT_AT_BOTTOM_THRESHOLD_PX,
				scrollHeight: 2000,
				clientHeight: 1000,
			})
		).toBe(true);
	});

	test("boundary: one pixel past threshold is not at-bottom", () => {
		expect(
			isAtBottom({
				scrollTop: 1000 - DEFAULT_AT_BOTTOM_THRESHOLD_PX - 1,
				scrollHeight: 2000,
				clientHeight: 1000,
			})
		).toBe(false);
	});

	test("content shorter than viewport is at-bottom", () => {
		expect(isAtBottom({ scrollTop: 0, scrollHeight: 400, clientHeight: 1000 })).toBe(true);
	});
});

describe("onScrollMeasure (re-engage at the edge)", () => {
	const atBottom = { scrollTop: 990, scrollHeight: 2000, clientHeight: 1000 };
	const scrolledUp = { scrollTop: 200, scrollHeight: 2000, clientHeight: 1000 };

	test("reaching the bottom clears released and unread (can't get stuck)", () => {
		const next = onScrollMeasure({ released: true, hasUnreadBelow: true }, atBottom);
		expect(next).toEqual({ released: false, hasUnreadBelow: false });
	});

	test("scrolled above the edge leaves state unchanged", () => {
		const prev = { released: true, hasUnreadBelow: true };
		expect(onScrollMeasure(prev, scrolledUp)).toEqual(prev);
	});

	test("following + at bottom stays following", () => {
		expect(onScrollMeasure(initialStickState, atBottom)).toEqual(initialStickState);
	});
});

describe("shouldReleaseOnUserScroll (programmatic guard)", () => {
	test("a programmatic scroll never releases follow", () => {
		expect(shouldReleaseOnUserScroll({ isProgrammatic: true, atBottom: false })).toBe(false);
	});

	test("a user scroll away from the bottom releases follow", () => {
		expect(shouldReleaseOnUserScroll({ isProgrammatic: false, atBottom: false })).toBe(true);
	});

	test("a user scroll that stays at the bottom does not release", () => {
		expect(shouldReleaseOnUserScroll({ isProgrammatic: false, atBottom: true })).toBe(false);
	});
});

describe("onContentChange", () => {
	test("following: content append pins to the live edge", () => {
		const { state, action } = onContentChange(initialStickState, {
			anchorDeltaPx: 0,
			grewBelow: true,
		});
		expect(action).toEqual({ kind: "toBottom" });
		expect(state).toEqual(initialStickState);
	});

	test("released: preserve the tracked anchor by the above-delta and flag unread", () => {
		const { state, action } = onContentChange(
			{ released: true, hasUnreadBelow: false },
			{ anchorDeltaPx: 160, grewBelow: true }
		);
		expect(action).toEqual({ kind: "preserveAnchor", deltaPx: 160 });
		expect(state).toEqual({ released: true, hasUnreadBelow: true });
	});

	test("released: a change with no anchor drift and nothing below leaves unread untouched", () => {
		const { state, action } = onContentChange(
			{ released: true, hasUnreadBelow: false },
			{ anchorDeltaPx: 0, grewBelow: false }
		);
		expect(action).toEqual({ kind: "none" });
		expect(state).toEqual({ released: true, hasUnreadBelow: false });
	});

	test("released: anchor drift with nothing new below still corrects position but no unread", () => {
		const { state, action } = onContentChange(
			{ released: true, hasUnreadBelow: false },
			{ anchorDeltaPx: 90, grewBelow: false }
		);
		expect(action).toEqual({ kind: "preserveAnchor", deltaPx: 90 });
		expect(state.hasUnreadBelow).toBe(false);
	});
});

describe("onSend (anchor near top, keep following)", () => {
	test("pins to the spacer-backed bottom and keeps follow engaged", () => {
		const { state, action } = onSend({ released: true, hasUnreadBelow: true }, "row-42", 64);
		expect(state).toEqual({ released: false, hasUnreadBelow: false });
		expect(action).toEqual({ kind: "toBottom" });
	});
});

describe("computeSendAnchorSpacerPx", () => {
	test("adds enough bottom spacer to make max-scroll place the sent row near the top", () => {
		const spacerPx = computeSendAnchorSpacerPx({
			viewportHeightPx: 1000,
			contentHeightWithoutSpacerPx: 2100,
			rowTopPx: 1600,
			peekPx: 72,
		});

		expect(spacerPx).toBe(428);
		expect(2100 + spacerPx - 1000).toBe(1600 - 72);
	});

	test("clamps to zero when enough content already exists below the sent row", () => {
		expect(
			computeSendAnchorSpacerPx({
				viewportHeightPx: 1000,
				contentHeightWithoutSpacerPx: 2600,
				rowTopPx: 1200,
				peekPx: 72,
			})
		).toBe(0);
	});
});

describe("jumpToLatest", () => {
	test("re-engages follow, clears unread, pins to bottom", () => {
		const { state, action } = jumpToLatest({ released: true, hasUnreadBelow: true });
		expect(state).toEqual({ released: false, hasUnreadBelow: false });
		expect(action).toEqual({ kind: "toBottom" });
	});
});

describe("anchorCorrectionPx", () => {
	test("correction equals the tracked row's top displacement so it stays stationary", () => {
		// row was at content-top 1000, now at 1160 after rows above grew estimate->real:
		// add 160 to scrollTop so its viewport position is unchanged.
		expect(anchorCorrectionPx(1000, 1160)).toBe(160);
	});

	test("no displacement => no correction", () => {
		expect(anchorCorrectionPx(500, 500)).toBe(0);
	});

	test("upward displacement (content shrank above) yields a negative correction", () => {
		expect(anchorCorrectionPx(1200, 1000)).toBe(-200);
	});
});
