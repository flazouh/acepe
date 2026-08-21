import { describe, expect, it } from "bun:test"

import { tracerTranscriptRow } from "./tracer-transcript-state.js"

describe("tracerTranscriptRow", () => {
	it("keeps key role and text in the given order", () => {
		const row = tracerTranscriptRow({
			key: "message-user",
			role: "user",
			text: "Ping"
		})
		expect(row.key).toBe("message-user")
		expect(row.role).toBe("user")
		expect(row.text).toBe("Ping")
	})
})
