import * as Vitest from "@effect/vitest"
import { isTurnTerminalFact, providerSessionFact } from "./Facts.ts"

Vitest.describe("providerSessionFact", () => {
	Vitest.it("carries the provider session id", () => {
		Vitest.assert.deepStrictEqual(providerSessionFact("acp-1"), {
			contractKind: "provider_session",
			providerSessionId: "acp-1"
		})
	})
})

Vitest.describe("isTurnTerminalFact", () => {
	Vitest.it("is true for turn_complete and turn_error only", () => {
		Vitest.assert.isTrue(isTurnTerminalFact({ contractKind: "turn_complete" }))
		Vitest.assert.isTrue(isTurnTerminalFact({ contractKind: "turn_error", detail: "refusal" }))
		Vitest.assert.isFalse(isTurnTerminalFact({ contractKind: "text_delta", token: "Hi" }))
	})
})
