import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ClaudeUsageApiResponse, parseClaudeResetTimestampMs } from "./claudeUsageApi.ts"

Vitest.describe("parseClaudeResetTimestampMs", () => {
	Vitest.it("treats a large numeric string as already-milliseconds", () => {
		Vitest.assert.strictEqual(parseClaudeResetTimestampMs("4102448400000"), 4_102_448_400_000)
	})

	Vitest.it("treats a small numeric string as seconds and scales to ms", () => {
		Vitest.assert.strictEqual(parseClaudeResetTimestampMs("4102448400"), 4_102_448_400_000)
	})

	Vitest.it("parses an RFC3339 timestamp", () => {
		Vitest.assert.strictEqual(parseClaudeResetTimestampMs("2100-01-01T00:00:00Z"), 4_102_444_800_000)
	})

	Vitest.it("returns null for missing, blank, or unparseable input", () => {
		Vitest.assert.isNull(parseClaudeResetTimestampMs(null))
		Vitest.assert.isNull(parseClaudeResetTimestampMs(undefined))
		Vitest.assert.isNull(parseClaudeResetTimestampMs("   "))
		Vitest.assert.isNull(parseClaudeResetTimestampMs("not a timestamp"))
	})
})

Vitest.describe("ClaudeUsageApiResponse", () => {
	Vitest.it.effect("decodes a response with some buckets present and others absent", () =>
		Effect.gen(function*() {
			const decoded = yield* Schema.decodeUnknownEffect(ClaudeUsageApiResponse)({
				five_hour: { utilization: 42, resets_at: "2100-01-01T00:00:00Z" },
				seven_day_opus: { utilization: 70, resets_at: "4102448400" },
			})
			Vitest.assert.strictEqual(decoded.five_hour?.utilization, 42)
			Vitest.assert.strictEqual(decoded.seven_day, undefined)
			Vitest.assert.strictEqual(decoded.seven_day_opus?.utilization, 70)
		})
	)

	Vitest.it.effect("decodes a bucket with a null resets_at", () =>
		Effect.gen(function*() {
			const decoded = yield* Schema.decodeUnknownEffect(ClaudeUsageApiResponse)({
				five_hour: { utilization: 10, resets_at: null },
			})
			Vitest.assert.isNull(decoded.five_hour?.resets_at ?? null)
		})
	)
})
