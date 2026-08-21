import { describe, expect, it } from "bun:test"

import {
	createMemoryScrollHost,
	FOLLOW_RELEASE_INTENT_EVENTS,
	GENERIC_SCROLL_EVENT,
	hostFromElement,
	readHostScrollMetrics,
	type DomScrollElement,
} from "./host.ts"

describe("FOLLOW_RELEASE_INTENT_EVENTS", () => {
	it("gates release on wheel, touch, key, and scrollbar pointerdown, not generic scroll", () => {
		expect(FOLLOW_RELEASE_INTENT_EVENTS).toEqual([
			"wheel",
			"touchstart",
			"touchmove",
			"keydown",
			"pointerdown",
		])
		expect(FOLLOW_RELEASE_INTENT_EVENTS).not.toContain(GENERIC_SCROLL_EVENT)
	})
})

describe("createMemoryScrollHost", () => {
	it("reads and writes scroll geometry", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		host.scrollTop = 250
		expect(readHostScrollMetrics(host)).toEqual({
			scrollTop: 250,
			scrollHeight: 2000,
			clientHeight: 1000,
		})
		host.setScrollHeight(2400)
		expect(host.scrollHeight).toBe(2400)
	})

	it("emits to registered listeners and stops after remove", () => {
		const host = createMemoryScrollHost({ scrollHeight: 2000, clientHeight: 1000 })
		const seen: Array<number> = []
		const listener = (event: { readonly type: string; readonly deltaY?: number }): void => {
			if (event.type === "wheel") {
				seen.push(event.deltaY === undefined ? 0 : event.deltaY)
			}
		}
		host.addEventListener("wheel", listener)
		host.emit({ type: "wheel", deltaY: -200 })
		host.removeEventListener("wheel", listener)
		host.emit({ type: "wheel", deltaY: -10 })
		expect(seen).toEqual([-200])
	})
})

describe("hostFromElement", () => {
	it("mirrors scrollTop and forwards a wheel event", () => {
		let scrollTop = 10
		const forwarded: Array<(event: object) => void> = []
		const el: DomScrollElement = {
			get scrollTop(): number {
				return scrollTop
			},
			set scrollTop(value: number) {
				scrollTop = value
			},
			scrollHeight: 2000,
			clientHeight: 1000,
			clientWidth: 980,
			addEventListener(_type, listener) {
				forwarded.push(listener)
			},
			removeEventListener() {},
		}
		const host = hostFromElement(el)
		expect(host.scrollTop).toBe(10)
		host.scrollTop = 40
		expect(scrollTop).toBe(40)
		const deltas: Array<number> = []
		host.addEventListener("wheel", (event) => {
			if (event.type === "wheel") {
				deltas.push(event.deltaY)
			}
		})
		const mapped = forwarded[0]
		expect(mapped).toBeDefined()
		if (mapped !== undefined) {
			mapped({ deltaY: -200 })
		}
		expect(deltas).toEqual([-200])
	})
})
