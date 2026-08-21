import { describe, expect, it } from "bun:test"

import { tracerTranscriptRow } from "./tracer-transcript-state.js"

describe("TracerTranscript view contract", () => {
	it("renders from row props without sorting", () => {
		const first = tracerTranscriptRow({ key: "user", role: "user", text: "Ping" })
		const second = tracerTranscriptRow({
			key: "assistant",
			role: "assistant",
			text: "Hello from Acepe.",
		})
		expect([first.key, second.key]).toEqual(["user", "assistant"])
	})
})
