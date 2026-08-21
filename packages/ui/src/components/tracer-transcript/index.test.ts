import { describe, expect, it } from "bun:test"

import { tracerTranscriptRow } from "./index.js"

describe("tracer-transcript exports", () => {
	it("exports the row constructor", () => {
		expect(tracerTranscriptRow({ key: "a", role: "assistant", text: "Hello" }).text).toBe(
			"Hello",
		)
	})
})
