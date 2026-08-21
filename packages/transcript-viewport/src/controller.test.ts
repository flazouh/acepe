import { describe, expect, it } from "bun:test"

import {
	followIsStrandedAboveEdge,
	traceContentVisibilityRemeasure,
} from "./contentVisibilityTrace.ts"
import {
	applyScrollAction,
	createTranscriptViewportController,
} from "./controller.ts"
import { WEBVIEW_ENGINES } from "./engines.ts"
import type { StickState } from "./follow.ts"
import {
	createMemoryScrollHost,
	readHostScrollMetrics,
	type ViewportScheduler,
} from "./host.ts"

const idleScheduler: ViewportScheduler = {
	scheduleFrame: (_run) => () => {},
	scheduleTimeout: (_run, _delayMs) => () => {},
}

type ControllerExtra = {
	readonly nowMs?: () => number
	readonly scheduler?: ViewportScheduler
	readonly resolveAnchor?: () => { readonly rowId: string; readonly topPx: number } | null
	readonly resolveRowTop?: (rowId: string) => number | null
	readonly coalesceScrollHandling?: boolean
	readonly onEdgeStateChange?: (state: {
		readonly atTop: boolean
		readonly atBottom: boolean
	}) => void
	readonly onStateChange?: (state: StickState) => void
}

const controllerFor = (
	host: ReturnType<typeof createMemoryScrollHost>,
	extra: ControllerExtra = {},
) => {
	const params: {
		nowMs: () => number
		scheduler: ViewportScheduler
		onStateChange: (state: StickState) => void
		resolveAnchor?: () => { readonly rowId: string; readonly topPx: number } | null
		resolveRowTop?: (rowId: string) => number | null
		coalesceScrollHandling?: boolean
		onEdgeStateChange?: (state: {
			readonly atTop: boolean
			readonly atBottom: boolean
		}) => void
	} = {
		nowMs: extra.nowMs === undefined ? () => 0 : extra.nowMs,
		scheduler: extra.scheduler === undefined ? idleScheduler : extra.scheduler,
		onStateChange: (state) => {
			if (extra.onStateChange !== undefined) {
				extra.onStateChange(state)
			}
		},
	}
	if (extra.resolveAnchor !== undefined) {
		params.resolveAnchor = extra.resolveAnchor
	}
	if (extra.resolveRowTop !== undefined) {
		params.resolveRowTop = extra.resolveRowTop
	}
	if (extra.coalesceScrollHandling !== undefined) {
		params.coalesceScrollHandling = extra.coalesceScrollHandling
	}
	if (extra.onEdgeStateChange !== undefined) {
		params.onEdgeStateChange = extra.onEdgeStateChange
	}
	return createTranscriptViewportController(host, params)
}

describe("applyScrollAction", () => {
	it("toBottom pins to max scrollTop", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		expect(applyScrollAction(host, { kind: "toBottom" })).toBe(true)
		expect(host.scrollTop).toBe(1000)
	})

	it("preserveAnchor shifts scrollTop by the delta", () => {
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 500,
		})
		expect(applyScrollAction(host, { kind: "preserveAnchor", deltaPx: 160 })).toBe(true)
		expect(host.scrollTop).toBe(660)
	})

	it("anchorRowNearTop places the row top minus the peek", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const resolveRowTop = (rowId: string): number | null => (rowId === "row-7" ? 900 : null)
		expect(
			applyScrollAction(
				host,
				{ kind: "anchorRowNearTop", rowId: "row-7", peekPx: 64 },
				resolveRowTop,
			),
		).toBe(true)
		expect(host.scrollTop).toBe(836)
	})

	it("none leaves scrollTop untouched", () => {
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 300,
		})
		expect(applyScrollAction(host, { kind: "none" })).toBe(false)
		expect(host.scrollTop).toBe(300)
	})
})

describe("createTranscriptViewportController", () => {
	it("releases follow on a user scroll (wheel) away from the bottom", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		host.emit({ type: "wheel", deltaY: -200 })
		host.scrollTop = 200
		host.emit({ type: "scroll" })
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false })
		c.destroy()
	})

	it("does NOT release on a layout-driven scroll with no user intent", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		host.scrollTop = 200
		host.emit({ type: "scroll" })
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false })
		c.destroy()
	})

	it("does NOT release during the settle window after programmatic pins", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		host.setScrollHeight(2400)
		c.notifyContentChanged()
		host.setScrollHeight(2800)
		c.notifyContentChanged()
		host.scrollTop = 1200
		host.emit({ type: "scroll" })
		expect(c.getState().released).toBe(false)
		c.destroy()
	})

	it("re-engages follow when the user scrolls back to the bottom", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		host.emit({ type: "wheel", deltaY: -200 })
		host.scrollTop = 200
		host.emit({ type: "scroll" })
		expect(c.getState().released).toBe(true)
		host.emit({ type: "wheel", deltaY: 200 })
		host.scrollTop = 990
		host.emit({ type: "scroll" })
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false })
		c.destroy()
	})

	it("does not mistake a programmatic scroll for a user scroll-away", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host, { resolveRowTop: () => 1000 })
		c.onSend()
		expect(host.scrollTop).toBe(1000)
		host.emit({ type: "scroll" })
		expect(c.getState().released).toBe(false)
		c.destroy()
	})

	it("lets touch scrolling release immediately after the send pin", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		c.onSend()
		expect(host.scrollTop).toBe(1000)
		host.emit({ type: "touchstart" })
		host.scrollTop = 700
		host.emit({ type: "scroll" })
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false })
		expect(host.scrollTop).toBe(700)
		c.destroy()
	})

	it("lets a scrollbar drag release immediately after the send pin", () => {
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			clientWidth: 980,
		})
		const c = controllerFor(host)
		c.onSend()
		host.emit({ type: "pointerdown", offsetX: 990 })
		host.scrollTop = 700
		host.emit({ type: "scroll" })
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false })
		c.destroy()
	})

	it("releases on PageUp key intent", () => {
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 1000,
		})
		const c = controllerFor(host)
		host.emit({ type: "keydown", key: "PageUp" })
		expect(c.getState().released).toBe(true)
		c.destroy()
	})

	it("following + content shrink re-pins to the new bottom", () => {
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 1000,
		})
		const c = controllerFor(host)
		host.setScrollHeight(1400)
		c.notifyContentChanged()
		expect(host.scrollTop).toBe(400)
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false })
		c.destroy()
	})

	it("following + content growth pins to the new bottom", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		host.setScrollHeight(2400)
		c.notifyContentChanged()
		expect(host.scrollTop).toBe(1400)
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false })
		c.destroy()
	})

	it("released + content appended below flags unread without moving the view", () => {
		const anchor = { rowId: "a", topPx: 600 }
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 500,
		})
		const c = controllerFor(host, { resolveAnchor: () => anchor })
		host.emit({ type: "wheel", deltaY: -200 })
		host.emit({ type: "scroll" })
		host.setScrollHeight(2200)
		c.notifyContentChanged()
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: true })
		expect(host.scrollTop).toBe(500)
		c.destroy()
	})

	it("released + rows above re-measure preserves the JS anchor without unread", () => {
		const anchor = { rowId: "a", topPx: 600 }
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 500,
		})
		const c = controllerFor(host, { resolveAnchor: () => anchor })
		host.emit({ type: "wheel", deltaY: -200 })
		host.emit({ type: "scroll" })
		anchor.topPx = 760
		host.setScrollHeight(2160)
		c.notifyContentChanged()
		expect(host.scrollTop).toBe(660)
		expect(c.getState().hasUnreadBelow).toBe(false)
		c.destroy()
	})

	it("jumpToLatest re-pins to the bottom and clears unread", () => {
		const anchor = { rowId: "a", topPx: 600 }
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 200,
		})
		const c = controllerFor(host, { resolveAnchor: () => anchor })
		host.emit({ type: "wheel", deltaY: -200 })
		host.emit({ type: "scroll" })
		host.setScrollHeight(2200)
		c.notifyContentChanged()
		c.jumpToLatest()
		expect(host.scrollTop).toBe(1200)
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false })
		c.destroy()
	})

	it("openAt anchors a saved thread row near the top and leaves follow released", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host, {
			resolveRowTop: (rowId) => (rowId === "user-latest" ? 860 : null),
		})
		c.openAt("user-latest", 72)
		expect(host.scrollTop).toBe(788)
		expect(c.getState()).toEqual({ released: true, hasUnreadBelow: false })
		c.destroy()
	})

	it("openAt falls back to the live edge when the requested row is not mounted", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host, { resolveRowTop: () => null })
		c.openAt("missing-row", 72)
		expect(host.scrollTop).toBe(1000)
		expect(c.getState()).toEqual({ released: false, hasUnreadBelow: false })
		c.destroy()
	})

	it("releases on upward wheel intent before content changes", () => {
		const anchor = { rowId: "a", topPx: 1200 }
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 1000,
		})
		const c = controllerFor(host, { resolveAnchor: () => anchor })
		host.emit({ type: "wheel", deltaY: -200 })
		host.setScrollHeight(2400)
		c.notifyContentChanged()
		expect(c.getState().released).toBe(true)
		expect(host.scrollTop).toBe(1000)
		c.destroy()
	})

	it("keeps upward scroll released when content changes after a slow frame", () => {
		let timeMs = 0
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 1000,
		})
		const c = controllerFor(host, { nowMs: () => timeMs })
		host.emit({ type: "wheel", deltaY: -200 })
		host.emit({ type: "scroll" })
		timeMs = 300
		host.setScrollHeight(2400)
		c.notifyContentChanged()
		expect(c.getState().released).toBe(true)
		expect(host.scrollTop).toBe(1000)
		c.destroy()
	})

	it("coalesces scroll handling to one scheduled frame when requested", () => {
		const frames: Array<() => void> = []
		const scheduler: ViewportScheduler = {
			scheduleFrame: (run) => {
				frames.push(run)
				return () => {
					const index = frames.indexOf(run)
					if (index >= 0) {
						frames.splice(index, 1)
					}
				}
			},
			scheduleTimeout: (_run, _delayMs) => () => {},
		}
		const edges: Array<{ atTop: boolean; atBottom: boolean }> = []
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host, {
			scheduler,
			coalesceScrollHandling: true,
			onEdgeStateChange: (state) => {
				edges.push(state)
			},
		})
		host.scrollTop = 100
		host.emit({ type: "scroll" })
		host.scrollTop = 200
		host.emit({ type: "scroll" })
		expect(frames.length).toBe(1)
		const frame = frames[0]
		if (frame === undefined) {
			expect(frame).toBeDefined()
			c.destroy()
			return
		}
		frame()
		expect(edges).toEqual([
			{ atTop: true, atBottom: false },
			{ atTop: false, atBottom: false },
		])
		c.destroy()
	})

	it("detaches its scroll listener on destroy", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const c = controllerFor(host)
		c.destroy()
		host.emit({ type: "wheel", deltaY: -200 })
		host.scrollTop = 200
		host.emit({ type: "scroll" })
		expect(c.getState().released).toBe(false)
	})
})

describe("content-visibility remeasure rAF trace", () => {
	it("does not strand follow above the edge across a height burst", () => {
		const host = createMemoryScrollHost({
			scrollHeight: 2000,
			clientHeight: 1000,
			scrollTop: 1000,
		})
		const c = controllerFor(host)
		const frames = traceContentVisibilityRemeasure({
			heights: [1400, 1800, 1600, 2100],
			readMetrics: () => readHostScrollMetrics(host),
			readState: () => c.getState(),
			applyHeight: (scrollHeight) => {
				host.setScrollHeight(scrollHeight)
			},
			notifyContentChanged: () => {
				c.notifyContentChanged()
			},
		})
		for (const frame of frames) {
			expect(
				followIsStrandedAboveEdge(
					{ released: frame.released, hasUnreadBelow: frame.hasUnreadBelow },
					{
						scrollTop: frame.scrollTop,
						scrollHeight: frame.scrollHeight,
						clientHeight: frame.clientHeight,
					},
				),
			).toBe(false)
			expect(frame.released).toBe(false)
			expect(frame.atBottom).toBe(true)
		}
		c.destroy()
	})

	it("holds the same rAF-trace contract on all three webview engines", () => {
		for (const engine of WEBVIEW_ENGINES) {
			const host = createMemoryScrollHost({
				scrollHeight: 2000,
				clientHeight: 1000,
				scrollTop: 1000,
			})
			const c = controllerFor(host)
			const frames = traceContentVisibilityRemeasure({
				heights: [1500, 1900],
				readMetrics: () => readHostScrollMetrics(host),
				readState: () => c.getState(),
				applyHeight: (scrollHeight) => {
					host.setScrollHeight(scrollHeight)
				},
				notifyContentChanged: () => {
					c.notifyContentChanged()
				},
			})
			expect(engine.jsScrollAnchoring).toBe(true)
			for (const frame of frames) {
				expect(frame.released).toBe(false)
				expect(frame.atBottom).toBe(true)
			}
			c.destroy()
		}
	})
})
