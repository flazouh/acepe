import { describe, expect, it } from "bun:test"

import { SessionId, TerminalId } from "./ids.ts"
import {
	capTerminalOutput,
	DEFAULT_TERMINAL_COLS,
	DEFAULT_TERMINAL_ROWS,
	emptyProjectedTerminal,
	TERMINAL_OUTPUT_CAP,
} from "./terminal.ts"

describe("capTerminalOutput", () => {
	it("keeps output that is under the cap", () => {
		expect(capTerminalOutput("echo hi")).toBe("echo hi")
	})

	it("drops characters from the front when the cap is exceeded", () => {
		const prefix = "DROP"
		const kept = "K".repeat(TERMINAL_OUTPUT_CAP)
		expect(capTerminalOutput(`${prefix}${kept}`)).toBe(kept)
	})
})

describe("emptyProjectedTerminal", () => {
	it("starts with an empty ring and default size", () => {
		const row = emptyProjectedTerminal(
			TerminalId.make("term-1"),
			SessionId.make("session-1"),
			"/tmp",
			0,
		)
		expect(row.output).toBe("")
		expect(row.closed).toBe(false)
		expect(row.cols).toBe(DEFAULT_TERMINAL_COLS)
		expect(row.rows).toBe(DEFAULT_TERMINAL_ROWS)
	})
})
