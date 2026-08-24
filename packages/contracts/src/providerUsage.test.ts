import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
	GetProviderAccountUsageRequest,
	GetProviderAccountUsageResponse,
	ProviderAccountUsage,
} from "./providerUsage.ts"

describe("GetProviderAccountUsageRequest", () => {
	it("decodes an empty request with no provider filter", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(GetProviderAccountUsageRequest)({}))
		expect(decoded.provider).toBeUndefined()
	})

	it("decodes a request scoped to a single known provider", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GetProviderAccountUsageRequest)({ provider: "codex" }),
		)
		expect(decoded.provider).toBe("codex")
	})

	it("rejects an unknown provider id", () => {
		const decoded = Effect.runSyncExit(
			Schema.decodeUnknownEffect(GetProviderAccountUsageRequest)({ provider: "not-a-provider" }),
		)
		expect(decoded._tag).toBe("Failure")
	})
})

describe("ProviderAccountUsage", () => {
	it("decodes a connected provider with quota windows", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(ProviderAccountUsage)({
				providerId: "codex",
				displayName: "Codex",
				plan: "pro",
				capturedAtMs: 1_782_212_400_000,
				connection: "connected",
				windows: [
					{
						id: "primary",
						label: "5h window",
						role: "primaryShort",
						usedFraction: 0.25,
						windowMinutes: 300,
						resetsAtMs: 1_782_251_981_000,
					},
				],
				message: null,
			}),
		)
		expect(decoded.windows).toHaveLength(1)
		expect(decoded.windows[0]?.usedFraction).toBe(0.25)
	})

	it("decodes an unavailable provider carrying a human-readable message and no windows", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(ProviderAccountUsage)({
				providerId: "cursor",
				displayName: "Cursor",
				plan: null,
				capturedAtMs: 1_782_212_400_000,
				connection: "unavailable",
				windows: [],
				message: "Cursor quota needs the Cursor account API",
			}),
		)
		expect(decoded.connection).toBe("unavailable")
		expect(decoded.windows).toEqual([])
		expect(decoded.message).toBe("Cursor quota needs the Cursor account API")
	})

	it("rejects a blank providerId", () => {
		const decoded = Effect.runSyncExit(
			Schema.decodeUnknownEffect(ProviderAccountUsage)({
				providerId: "   ",
				displayName: "Codex",
				plan: null,
				capturedAtMs: 0,
				connection: "unavailable",
				windows: [],
				message: null,
			}),
		)
		expect(decoded._tag).toBe("Failure")
	})
})

describe("GetProviderAccountUsageResponse", () => {
	it("round-trips an array of providers", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GetProviderAccountUsageResponse)([
				{
					providerId: "claude-code",
					displayName: "Claude Code",
					plan: "Claude Code",
					capturedAtMs: 1_782_212_400_000,
					connection: "connected",
					windows: [],
					message: null,
				},
			]),
		)
		expect(decoded).toHaveLength(1)
		expect(decoded[0]?.providerId).toBe("claude-code")
	})
})
