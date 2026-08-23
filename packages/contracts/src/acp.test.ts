import { describe, expect, it } from "bun:test"

import { ACP_SESSION_COMMAND_TYPES } from "./acp.ts"

describe("ACP session command domain", () => {
	it("has 33 session and agent commands", () => {
		expect(ACP_SESSION_COMMAND_TYPES.length).toBe(33)
		expect(new Set(ACP_SESSION_COMMAND_TYPES).size).toBe(33)
	})
})
