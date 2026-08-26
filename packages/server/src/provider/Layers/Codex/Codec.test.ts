import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { decodeContractFact, encodeContractFact } from "./Codec.ts"
import { providerSessionFact } from "./Facts.ts"

Vitest.describe("Codex contract fact codec", () => {
	Vitest.it("round-trips a provider session fact", () => {
		const fact = providerSessionFact("thread-1")
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			Vitest.assert.deepStrictEqual(decodeContractFact(encoded.value), Option.some(fact))
		}
	})
})
