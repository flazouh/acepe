import { describe, expect, it } from "bun:test"

import {
	followIsStrandedAboveEdge,
	traceContentVisibilityRemeasure,
} from "./contentVisibilityTrace.ts"
import { DEFAULT_AT_BOTTOM_THRESHOLD_PX } from "./follow.ts"

describe("followIsStrandedAboveEdge", () => {
	it("is true only while following and above the live edge", () => {
		const metrics = { scrollTop: 200, scrollHeight: 2000, clientHeight: 1000 }
		expect(
			followIsStrandedAboveEdge({ released: false, hasUnreadBelow: false }, metrics),
		).toBe(true)
		expect(
			followIsStrandedAboveEdge({ released: true, hasUnreadBelow: false }, metrics),
		).toBe(false)
		expect(
			followIsStrandedAboveEdge(
				{ released: false, hasUnreadBelow: false },
				{ scrollTop: 1000, scrollHeight: 2000, clientHeight: 1000 },
			),
		).toBe(false)
		expect(DEFAULT_AT_BOTTOM_THRESHOLD_PX).toBe(24)
	})
})

describe("traceContentVisibilityRemeasure", () => {
	it("records one frame per height notify", () => {
		let scrollHeight = 2000
		let scrollTop = 1000
		const frames = traceContentVisibilityRemeasure({
			heights: [1400, 1800],
			readMetrics: () => ({
				scrollTop,
				scrollHeight,
				clientHeight: 1000,
			}),
			readState: () => ({ released: false, hasUnreadBelow: false }),
			applyHeight: (next) => {
				scrollHeight = next
				scrollTop = Math.max(0, next - 1000)
			},
			notifyContentChanged: () => {},
		})
		expect(frames.length).toBe(3)
		expect(frames[0]?.scrollHeight).toBe(2000)
		expect(frames[1]?.scrollHeight).toBe(1400)
		expect(frames[2]?.scrollHeight).toBe(1800)
	})
})
