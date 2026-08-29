import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
	SessionModelCatalog,
	SessionModelsListedFact,
	StoredSessionModelCatalog,
} from "./sessionModels.ts"

const decodeFact = Schema.decodeUnknownEffect(SessionModelsListedFact)
const encodeStored = Schema.encodeEffect(StoredSessionModelCatalog)
const decodeStored = Schema.decodeUnknownEffect(StoredSessionModelCatalog)
const decodeCatalog = Schema.decodeUnknownEffect(SessionModelCatalog)

describe("SessionModelsListedFact", () => {
	it("decodes the catalog an adapter encodes onto event metadata", () => {
		const fact = Effect.runSync(
			decodeFact({
				contractKind: "session_models",
				models: [
					{
						modelId: "claude-opus-5",
						name: "Opus 5",
						description: "Most capable model",
					},
					{ modelId: "claude-sonnet-5", name: "Sonnet 5", description: null },
				],
			}),
		)
		expect(fact.models.length).toBe(2)
		expect(fact.models[0]?.modelId).toBe("claude-opus-5")
		expect(fact.models[0]?.description).toBe("Most capable model")
		expect(fact.models[1]?.description).toBe(null)
	})

	it("rejects a model with no id", () => {
		const decoded = Effect.runSyncExit(
			decodeFact({
				contractKind: "session_models",
				models: [{ modelId: "  ", name: "Nameless", description: null }],
			}),
		)
		expect(decoded._tag).toBe("Failure")
	})
})

describe("StoredSessionModelCatalog", () => {
	it("round-trips a catalog through its stored JSON text", () => {
		const catalog = Effect.runSync(
			decodeCatalog([{ modelId: "claude-opus-5", name: "Opus 5", description: null }]),
		)
		const text = Effect.runSync(encodeStored(catalog))
		expect(typeof text).toBe("string")
		const back = Effect.runSync(decodeStored(text))
		expect(back).toEqual(catalog)
	})

	it("stores an unknown catalog as null", () => {
		expect(Effect.runSync(encodeStored(null))).toBe(null)
		expect(Effect.runSync(decodeStored(null))).toBe(null)
	})
})
