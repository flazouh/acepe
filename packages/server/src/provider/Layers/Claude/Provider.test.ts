import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import {
	isCapabilityEnabled,
	PROVIDER_CAPABILITY_NAMES
} from "../../Services/ProviderAdapter.ts"
import {
	CLAUDE_CAPABILITIES,
	CLAUDE_DEFERRED_SESSION_CREATION,
	CLAUDE_PROVIDER_ID,
	CLAUDE_REASONING_CONFIG_ID,
	CLAUDE_REASONING_PRESENTATION,
	claudePreconnectionConfigOptions,
	claudePresence,
	claudeReasoningEffortFromConfig,
	isClaudePlanCapabilityEnabled
} from "./Provider.ts"
import * as Option from "effect/Option"

Vitest.describe("ClaudeProvider", () => {
	Vitest.it("uses the claude-code provider id", () => {
		Vitest.assert.strictEqual(CLAUDE_PROVIDER_ID, "claude-code")
	})

	Vitest.it("enables deferred session creation", () => {
		Vitest.assert.strictEqual(CLAUDE_DEFERRED_SESSION_CREATION, true)
	})

	Vitest.it("advertises compact reasoning preconnection options for the new-thread setup bar", () => {
		const options = claudePreconnectionConfigOptions()
		const reasoning = Arr.findFirst(
			options,
			(option) => option.id === CLAUDE_REASONING_CONFIG_ID
		)
		Vitest.assert.strictEqual(reasoning._tag, "Some")
		if (reasoning._tag === "Some") {
			Vitest.assert.strictEqual(reasoning.value.presentation, CLAUDE_REASONING_PRESENTATION)
			Vitest.assert.strictEqual(reasoning.value.currentValue, "auto")
			Vitest.assert.strictEqual(reasoning.value.options?.length, 6)
		}
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

	Vitest.it("reports presence without reading process.env", () => {
		const presence = claudePresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, CLAUDE_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})

	// The one place that decides what a session's stored reasoning_effort
	// selection means for the SDK: "auto" and anything unrecognized both mean
	// "let the SDK decide" (no effort option), and only the catalog's own
	// values pass through.
	Vitest.describe("claudeReasoningEffortFromConfig", () => {
		Vitest.it("reads a chosen effort from the session's config options", () => {
			Vitest.assert.deepStrictEqual(
				claudeReasoningEffortFromConfig({ reasoning_effort: "max" }),
				Option.some("max")
			)
		})

		Vitest.it("treats auto as no explicit effort", () => {
			Vitest.assert.deepStrictEqual(
				claudeReasoningEffortFromConfig({ reasoning_effort: "auto" }),
				Option.none()
			)
		})

		Vitest.it("ignores an absent or unrecognized value", () => {
			Vitest.assert.deepStrictEqual(claudeReasoningEffortFromConfig({}), Option.none())
			Vitest.assert.deepStrictEqual(
				claudeReasoningEffortFromConfig({ reasoning_effort: "turbo" }),
				Option.none()
			)
		})
	})
})
