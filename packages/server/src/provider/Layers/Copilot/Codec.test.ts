import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
	acpSessionUpdateToFact,
	contractFactToAcpSessionUpdate,
	decodeContractFact,
	encodeContractFact,
	roundTripAcpSessionUpdate
} from "./Codec.ts"

type JsonObject = typeof Schema.JsonObject.Type

const jsonObject = (value: JsonObject): JsonObject => value

Vitest.describe("contract fact round-trip", () => {
	Vitest.it("encodes Copilot facts as ACP session updates and decodes them back", () => {
		const fact = {
			contractKind: "tool_call" as const,
			toolCallId: "call-2",
			title: "apply_patch",
			kind: "edit" as const,
			status: "completed" as const,
			rawInput: jsonObject({ fileName: "README.md" })
		}
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			const decoded = decodeContractFact(encoded.value)
			Vitest.assert.deepStrictEqual(decoded, Option.some(fact))
			const remapped = roundTripAcpSessionUpdate(contractFactToAcpSessionUpdate(fact))
			Vitest.assert.deepStrictEqual(remapped, Option.some(contractFactToAcpSessionUpdate(fact)))
		}
	})

	Vitest.it("round-trips a usage fact that carries a total beside its breakdown", () => {
		const fact = {
			contractKind: "usage" as const,
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			totalTokens: 16,
			costUsd: 0.02,
			contextWindowSize: 128000
		}
		const update = contractFactToAcpSessionUpdate(fact)
		Vitest.assert.deepStrictEqual(acpSessionUpdateToFact(update), Option.some(fact))
		Vitest.assert.deepStrictEqual(roundTripAcpSessionUpdate(update), Option.some(update))
	})
})
