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
			eventId: "copilot-token-usage:acp-1:total=16:input=12:output=4:cost=0.02:context=128000",
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

	// #274: the dedup key has to survive both hops — the storage encode/decode
	// pair that persists the fact, and the ACP projection the desktop reads.
	Vitest.it("keeps the usage eventId through the storage and ACP round-trips", () => {
		const fact = {
			contractKind: "usage" as const,
			sessionId: "acp-1",
			eventId: "copilot-token-usage:acp-1:total=16:input=12:output=4:cost=0.02:context=128000",
			inputTokens: 12,
			outputTokens: 4,
			totalTokens: 16,
			costUsd: 0.02,
			contextWindowSize: 128000
		}
		Vitest.assert.deepStrictEqual(
			Option.flatMap(encodeContractFact(fact), decodeContractFact),
			Option.some(fact)
		)
		Vitest.assert.deepStrictEqual(
			contractFactToAcpSessionUpdate(fact).eventId,
			"copilot-token-usage:acp-1:total=16:input=12:output=4:cost=0.02:context=128000"
		)
	})

	// A usage fact persisted before #274 carries no eventId, and still has to
	// decode — the schema field is optional for that reason alone.
	Vitest.it("decodes a usage fact stored before it carried an eventId", () => {
		Vitest.assert.deepStrictEqual(
			decodeContractFact(
				jsonObject({
					contractKind: "usage",
					sessionId: "acp-1",
					totalTokens: 16
				})
			),
			Option.some({
				contractKind: "usage" as const,
				sessionId: "acp-1",
				totalTokens: 16
			})
		)
	})
})
