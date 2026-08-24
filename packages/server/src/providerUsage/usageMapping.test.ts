import * as Vitest from "@effect/vitest"
import type { ClaudeUsageApiResponse } from "./claudeUsageApi.ts"
import type { CodexRateLimitSnapshot } from "./codexUsage.ts"
import {
	claudePlanLabel,
	claudeUsageResponseToWindows,
	claudeWindowsToProviderUsage,
	codexSnapshotToProviderUsage,
	unavailableProvider,
} from "./usageMapping.ts"

const NOW_MS = 1_782_212_400_000

Vitest.describe("codexSnapshotToProviderUsage", () => {
	Vitest.it("maps a snapshot with both windows to a connected provider", () => {
		const snapshot: CodexRateLimitSnapshot = {
			planType: "pro",
			capturedAtMs: NOW_MS,
			primary: { usedPercent: 125, windowMinutes: 300, resetsAtSeconds: 1_782_251_981 },
			secondary: { usedPercent: 80, windowMinutes: 10_080, resetsAtSeconds: 1_782_820_779 },
		}

		const usage = codexSnapshotToProviderUsage(snapshot)

		Vitest.assert.strictEqual(usage.providerId, "codex")
		Vitest.assert.strictEqual(usage.connection, "connected")
		Vitest.assert.strictEqual(usage.plan, "pro")
		Vitest.assert.strictEqual(usage.windows.length, 2)
		Vitest.assert.strictEqual(usage.windows[0]?.id, "primary")
		// used_percent 125 clamps to a used fraction of 1.0, matching the Rust side.
		Vitest.assert.strictEqual(usage.windows[0]?.usedFraction, 1)
		Vitest.assert.strictEqual(usage.windows[0]?.role, "primaryShort")
		Vitest.assert.strictEqual(usage.windows[0]?.resetsAtMs, 1_782_251_981_000)
		Vitest.assert.strictEqual(usage.windows[1]?.role, "weekly")
	})

	Vitest.it("reports unavailable when the snapshot has no windows", () => {
		const usage = codexSnapshotToProviderUsage({
			planType: null,
			capturedAtMs: NOW_MS,
			primary: null,
			secondary: null,
		})
		Vitest.assert.strictEqual(usage.connection, "unavailable")
		Vitest.assert.deepStrictEqual(usage.windows, [])
		Vitest.assert.isNotNull(usage.message)
	})
})

Vitest.describe("claudeUsageResponseToWindows", () => {
	Vitest.it("builds windows only for the buckets present, sorted alphabetically by id", () => {
		const response: ClaudeUsageApiResponse = {
			five_hour: { utilization: 42, resets_at: "2100-01-01T00:00:00Z" },
			seven_day_opus: { utilization: 70, resets_at: "4102448400" },
		}

		const windows = claudeUsageResponseToWindows(response, NOW_MS)

		Vitest.assert.strictEqual(windows.length, 2)
		Vitest.assert.deepStrictEqual(windows.map((window) => window.id), ["five-hour", "seven-day-opus"])
		Vitest.assert.strictEqual(windows[0]?.usedFraction, 0.42)
		Vitest.assert.strictEqual(windows[0]?.resetsAtMs, 4_102_444_800_000)
	})

	Vitest.it("zeroes the used fraction once a window's reset time has passed", () => {
		const response: ClaudeUsageApiResponse = {
			five_hour: { utilization: 90, resets_at: String(Math.floor(NOW_MS / 1_000) - 10) },
		}

		const windows = claudeUsageResponseToWindows(response, NOW_MS)

		Vitest.assert.strictEqual(windows[0]?.usedFraction, 0)
	})

	Vitest.it("returns an empty array when every bucket is absent", () => {
		Vitest.assert.deepStrictEqual(claudeUsageResponseToWindows({}, NOW_MS), [])
	})
})

Vitest.describe("claudeWindowsToProviderUsage", () => {
	Vitest.it("reports connected with the given plan when windows are present", () => {
		const usage = claudeWindowsToProviderUsage(
			[{ id: "five-hour", label: "5h window", role: "primaryShort", usedFraction: 0.1, windowMinutes: 300, resetsAtMs: null }],
			"Claude Pro",
			NOW_MS,
			null,
		)
		Vitest.assert.strictEqual(usage.connection, "connected")
		Vitest.assert.strictEqual(usage.plan, "Claude Pro")
	})

	Vitest.it("reports unavailable when there are no windows", () => {
		const usage = claudeWindowsToProviderUsage([], "Claude Pro", NOW_MS, null)
		Vitest.assert.strictEqual(usage.connection, "unavailable")
	})

	Vitest.it("carries a cached-usage message through to the mapped provider", () => {
		const usage = claudeWindowsToProviderUsage(
			[{ id: "five-hour", label: "5h window", role: "primaryShort", usedFraction: 0.18, windowMinutes: 300, resetsAtMs: null }],
			"Claude Code",
			123,
			"Showing cached Claude usage because live usage could not be refreshed",
		)
		Vitest.assert.strictEqual(
			usage.message,
			"Showing cached Claude usage because live usage could not be refreshed",
		)
	})
})

Vitest.describe("claudePlanLabel", () => {
	Vitest.it("labels a subscription-less account as Claude Code", () => {
		Vitest.assert.strictEqual(
			claudePlanLabel({ hasAvailableSubscription: false, billingType: "stripe" }),
			"Claude Code",
		)
	})

	Vitest.it("labels a stripe-billed subscription as Claude Pro", () => {
		Vitest.assert.strictEqual(
			claudePlanLabel({ hasAvailableSubscription: true, billingType: "stripe" }),
			"Claude Pro",
		)
	})

	Vitest.it("labels any other billed subscription as a generic Claude subscription", () => {
		Vitest.assert.strictEqual(
			claudePlanLabel({ hasAvailableSubscription: true, billingType: null }),
			"Claude subscription",
		)
	})
})

Vitest.describe("unavailableProvider", () => {
	Vitest.it("carries the provider id, display name, and message with no windows or plan", () => {
		const usage = unavailableProvider("cursor", "Cursor", "Cursor quota needs the Cursor account API", NOW_MS)
		Vitest.assert.strictEqual(usage.providerId, "cursor")
		Vitest.assert.strictEqual(usage.connection, "unavailable")
		Vitest.assert.isNull(usage.plan)
		Vitest.assert.deepStrictEqual(usage.windows, [])
		Vitest.assert.strictEqual(usage.message, "Cursor quota needs the Cursor account API")
	})
})
