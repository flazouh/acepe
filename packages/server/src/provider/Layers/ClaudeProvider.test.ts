import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import {
	isCapabilityEnabled,
	PROVIDER_CAPABILITY_NAMES
} from "../Services/ProviderAdapter.ts"
import {
	CLAUDE_CAPABILITIES,
	CLAUDE_DEFERRED_SESSION_CREATION,
	CLAUDE_PROVIDER_ID,
	claudePresence,
	isClaudePlanCapabilityEnabled,
	resolveClaudeApiModelId
} from "./ClaudeProvider.ts"

Vitest.describe("ClaudeProvider", () => {
	Vitest.it("uses the claude-code provider id", () => {
		Vitest.assert.strictEqual(CLAUDE_PROVIDER_ID, "claude-code")
	})

	Vitest.it("enables deferred session creation", () => {
		Vitest.assert.strictEqual(CLAUDE_DEFERRED_SESSION_CREATION, true)
	})

	Vitest.it("enables plan, compaction, usage, tool, and permission capabilities", () => {
		Vitest.assert.deepStrictEqual(
			CLAUDE_CAPABILITIES.enabled,
			Arr.fromIterable(PROVIDER_CAPABILITY_NAMES)
		)
		Vitest.assert.strictEqual(isCapabilityEnabled(CLAUDE_CAPABILITIES, "plan"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CLAUDE_CAPABILITIES, "compaction"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CLAUDE_CAPABILITIES, "usage"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CLAUDE_CAPABILITIES, "toolCalls"), true)
		Vitest.assert.strictEqual(
			isCapabilityEnabled(CLAUDE_CAPABILITIES, "permissionRequests"),
			true
		)
		Vitest.assert.strictEqual(isClaudePlanCapabilityEnabled(), true)
	})

	Vitest.it("appends the 1m suffix only when the model id has no bracket", () => {
		Vitest.assert.strictEqual(
			resolveClaudeApiModelId("claude-opus-4-6", "1m"),
			"claude-opus-4-6[1m]"
		)
		Vitest.assert.strictEqual(
			resolveClaudeApiModelId("claude-opus-4-6[1m]", "1m"),
			"claude-opus-4-6[1m]"
		)
		Vitest.assert.strictEqual(
			resolveClaudeApiModelId("claude-sonnet-4-6", "200k"),
			"claude-sonnet-4-6"
		)
	})

	Vitest.it("reports presence without reading process.env", () => {
		const presence = claudePresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, CLAUDE_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})
})
