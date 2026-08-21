import { describe, expect, it } from "bun:test"

import {
	createMemoryScrollHost,
	createTranscriptViewportController,
	FOLLOW_RELEASE_INTENT_EVENTS,
	GENERIC_SCROLL_EVENT,
	rowsFromProjectedMessages,
	TRANSCRIPT_OVERFLOW_ANCHOR,
	WEBVIEW_ENGINES,
} from "./index.ts"

describe("package entry", () => {
	it("exposes the projection mapper, follow controller, and engine CSS contract", () => {
		expect(rowsFromProjectedMessages([]).length).toBe(0)
		expect(TRANSCRIPT_OVERFLOW_ANCHOR).toBe("none")
		expect(WEBVIEW_ENGINES.length).toBe(3)
		expect(FOLLOW_RELEASE_INTENT_EVENTS).not.toContain(GENERIC_SCROLL_EVENT)
		const host = createMemoryScrollHost({ scrollHeight: 100, clientHeight: 50 })
		const controller = createTranscriptViewportController(host, {
			nowMs: () => 0,
			scheduler: {
				scheduleFrame: (_run) => () => {},
				scheduleTimeout: (_run, _delayMs) => () => {},
			},
		})
		expect(controller.getState().released).toBe(false)
		controller.destroy()
	})
})
