import { describe, expect, it } from "bun:test"

import {
	anchorCorrectionPx,
	DEFAULT_AT_BOTTOM_THRESHOLD_PX,
	initialStickState,
	isAtBottom,
	jumpToLatest,
	onContentChange,
	onScrollMeasure,
	onSend,
	openAt,
	shouldReleaseOnUserScroll,
} from "./follow.ts"

const metrics = (input: {
	readonly scrollTop: number
	readonly scrollHeight: number
	readonly clientHeight: number
}) => input

describe("isAtBottom", () => {
	it("treats the live edge as at-bottom within the default slack", () => {
		expect(
			isAtBottom(metrics({ scrollTop: 976, scrollHeight: 2000, clientHeight: 1000 })),
		).toBe(true)
		expect(
			isAtBottom(metrics({ scrollTop: 975, scrollHeight: 2000, clientHeight: 1000 })),
		).toBe(false)
	})

	it("uses the supplied threshold", () => {
		expect(
			isAtBottom(metrics({ scrollTop: 990, scrollHeight: 2000, clientHeight: 1000 }), 5),
		).toBe(false)
		expect(DEFAULT_AT_BOTTOM_THRESHOLD_PX).toBe(24)
	})
})

describe("onScrollMeasure", () => {
	it("re-engages follow at the live edge", () => {
		const released = { released: true, hasUnreadBelow: true }
		expect(
			onScrollMeasure(
				released,
				metrics({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 1000 }),
			),
		).toEqual(initialStickState)
	})

	it("leaves a released state unchanged away from the edge", () => {
		const released = { released: true, hasUnreadBelow: true }
		expect(
			onScrollMeasure(
				released,
				metrics({ scrollTop: 200, scrollHeight: 2000, clientHeight: 1000 }),
			),
		).toEqual(released)
	})
})

describe("shouldReleaseOnUserScroll", () => {
	it("never releases a programmatic scroll", () => {
		expect(shouldReleaseOnUserScroll({ isProgrammatic: true, atBottom: false })).toBe(false)
	})

	it("releases a user scroll only when it leaves the edge", () => {
		expect(shouldReleaseOnUserScroll({ isProgrammatic: false, atBottom: false })).toBe(true)
		expect(shouldReleaseOnUserScroll({ isProgrammatic: false, atBottom: true })).toBe(false)
	})
})

describe("onContentChange", () => {
	it("pins to the live edge while following", () => {
		expect(
			onContentChange(initialStickState, { anchorDeltaPx: 80, grewBelow: true }),
		).toEqual({
			state: initialStickState,
			action: { kind: "toBottom" },
		})
	})

	it("preserves the anchor and flags unread while released", () => {
		expect(
			onContentChange(
				{ released: true, hasUnreadBelow: false },
				{ anchorDeltaPx: 160, grewBelow: true },
			),
		).toEqual({
			state: { released: true, hasUnreadBelow: true },
			action: { kind: "preserveAnchor", deltaPx: 160 },
		})
	})

	it("does not move the view when the released anchor did not drift", () => {
		expect(
			onContentChange(
				{ released: true, hasUnreadBelow: false },
				{ anchorDeltaPx: 0, grewBelow: false },
			),
		).toEqual({
			state: { released: true, hasUnreadBelow: false },
			action: { kind: "none" },
		})
	})
})

describe("onSend / openAt / jumpToLatest", () => {
	it("onSend reacquires the live edge", () => {
		expect(onSend({ released: true, hasUnreadBelow: true })).toEqual({
			state: initialStickState,
			action: { kind: "toBottom" },
		})
	})

	it("openAt releases follow and anchors a row near the top", () => {
		expect(openAt(initialStickState, "user-latest", 72)).toEqual({
			state: { released: true, hasUnreadBelow: false },
			action: { kind: "anchorRowNearTop", rowId: "user-latest", peekPx: 72 },
		})
	})

	it("jumpToLatest clears unread and pins to the bottom", () => {
		expect(jumpToLatest({ released: true, hasUnreadBelow: true })).toEqual({
			state: initialStickState,
			action: { kind: "toBottom" },
		})
	})
})

describe("anchorCorrectionPx", () => {
	it("shifts scrollTop by the tracked row's content-top displacement", () => {
		expect(anchorCorrectionPx(600, 760)).toBe(160)
		expect(anchorCorrectionPx(600, 600)).toBe(0)
	})
})
