import { describe, expect, it } from "bun:test"
import * as Arr from "effect/Array"

import {
	engineUsesJsScrollAnchoring,
	overflowAnchorCssFor,
	TRANSCRIPT_CONTENT_VISIBILITY,
	TRANSCRIPT_OVERFLOW_ANCHOR,
	WEBVIEW_ENGINE_IDS,
	WEBVIEW_ENGINES,
} from "./engines.ts"

describe("WEBVIEW_ENGINES", () => {
	it("covers the three shipping webview engines", () => {
		expect(WEBVIEW_ENGINE_IDS).toEqual([
			"webkit-macos",
			"webview2-windows",
			"webkitgtk-linux",
		])
		const ids = Arr.map(WEBVIEW_ENGINES, (engine) => engine.id)
		expect(ids.length).toBe(WEBVIEW_ENGINE_IDS.length)
		expect(ids[0]).toBe("webkit-macos")
		expect(ids[1]).toBe("webview2-windows")
		expect(ids[2]).toBe("webkitgtk-linux")
	})

	it("retains JS scroll anchoring on every engine, including WebView2", () => {
		for (const engine of WEBVIEW_ENGINES) {
			expect(engineUsesJsScrollAnchoring(engine)).toBe(true)
			expect(overflowAnchorCssFor(engine)).toBe("none")
			expect(engine.contentVisibility).toBe(true)
		}
		expect(WEBVIEW_ENGINES.find((engine) => engine.id === "webview2-windows")?.nativeOverflowAnchor).toBe(
			true,
		)
		expect(TRANSCRIPT_OVERFLOW_ANCHOR).toBe("none")
		expect(TRANSCRIPT_CONTENT_VISIBILITY).toBe("auto")
	})
})
