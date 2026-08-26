import { describe, expect, it } from "bun:test"
import * as Schema from "effect/Schema"

import {
	ACP_SESSION_COMMAND_TYPES,
	observedToolOutput,
	TOOL_OUTPUT_CAP,
	ToolCallObservedPayload,
} from "./acp.ts"

describe("ACP session command domain", () => {
	it("has 33 session and agent commands", () => {
		expect(ACP_SESSION_COMMAND_TYPES.length).toBe(33)
		expect(new Set(ACP_SESSION_COMMAND_TYPES).size).toBe(33)
	})
})

const decodeToolCallObserved = Schema.decodeUnknownSync(ToolCallObservedPayload)

const toolCallObserved = (output: string | null) => ({
	sessionId: "session-1",
	activityId: "activity-1",
	toolCallId: "call-1",
	operationId: null,
	status: "completed",
	title: "Bash",
	path: null,
	output,
})

describe("ToolCallObservedPayload output", () => {
	it("carries a completed tool call's output", () => {
		const payload = decodeToolCallObserved(toolCallObserved("file1\nfile2"))
		expect(payload.output).toBe("file1\nfile2")
	})

	it("carries null for a tool call with no output yet", () => {
		const payload = decodeToolCallObserved(toolCallObserved(null))
		expect(payload.output).toBe(null)
	})

	it("still decodes an event stored before the output field existed", () => {
		const payload = decodeToolCallObserved({
			sessionId: "session-1",
			activityId: "activity-1",
			toolCallId: "call-1",
			operationId: null,
			status: "completed",
			title: "Bash",
			path: null,
		})
		expect(payload.output).toBe(undefined)
	})
})

describe("observedToolOutput", () => {
	it("keeps a provider's output and trims its ends", () => {
		expect(observedToolOutput("  file1\nfile2  ")).toBe("file1\nfile2")
	})

	it("reads a blank output as no output", () => {
		expect(observedToolOutput("   \n  ")).toBe(null)
		expect(observedToolOutput(null)).toBe(null)
	})

	it("caps an output the append-only event log would otherwise keep for good", () => {
		const capped = observedToolOutput("x".repeat(TOOL_OUTPUT_CAP + 6_000))
		expect(capped?.length).toBe(TOOL_OUTPUT_CAP)
	})
})
