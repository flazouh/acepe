import { describe, expect, it } from "bun:test"

import {
	sessionAuthRequiredFact,
	sessionAuthRequiredFromMetadata,
} from "./sessionAuth.ts"

describe("sessionAuthRequiredFromMetadata", () => {
	it("recognizes the fact it writes", () => {
		expect(sessionAuthRequiredFromMetadata(sessionAuthRequiredFact)).toBe(true)
	})

	it("treats silence as no verdict, not signed-out", () => {
		expect(sessionAuthRequiredFromMetadata({})).toBe(false)
		expect(sessionAuthRequiredFromMetadata(null)).toBe(false)
		expect(sessionAuthRequiredFromMetadata({ contractKind: "session_models" })).toBe(false)
	})
})
