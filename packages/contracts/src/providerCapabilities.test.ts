import { describe, expect, it } from "bun:test"

import { providerPreconnectionCapabilityMode } from "./providerCapabilities.ts"

describe("providerPreconnectionCapabilityMode", () => {
	// Claude's catalog is account-level, not project-level: the SDK answers it
	// in the initialize handshake before any prompt, so one startup probe
	// serves every project.
	it("answers startupGlobal for every Claude id", () => {
		expect(providerPreconnectionCapabilityMode("claude")).toBe("startupGlobal")
		expect(providerPreconnectionCapabilityMode("claude-code")).toBe("startupGlobal")
		expect(providerPreconnectionCapabilityMode("claude_code")).toBe("startupGlobal")
	})

	it("answers unsupported for providers with no preconnection catalog", () => {
		expect(providerPreconnectionCapabilityMode("codex")).toBe("unsupported")
		expect(providerPreconnectionCapabilityMode("copilot")).toBe("unsupported")
		expect(providerPreconnectionCapabilityMode(null)).toBe("unsupported")
		expect(providerPreconnectionCapabilityMode(undefined)).toBe("unsupported")
	})
})
