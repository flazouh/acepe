import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { decodeContractFact, encodeContractFact } from "./Codec.ts"

Vitest.describe("contract fact codec", () => {
	Vitest.it("round-trips a text_delta fact", () => {
		const fact = {
			contractKind: "text_delta" as const,
			token: "Hello"
		}
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			Vitest.assert.deepStrictEqual(decodeContractFact(encoded.value), Option.some(fact))
		}
	})
})
