import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import {
	EXTERNAL_BACKEND_ID,
	EXTERNAL_BACKEND_NAME,
	EXTERNAL_BACKEND_SENTINEL_PATH
} from "./Schemas.ts"
import { listVoiceLanguages, makeExternalModelInfo, modelPathFor, validateModelId } from "./models.ts"

Vitest.describe("validateModelId", () => {
	Vitest.it("rejects an empty id", () => {
		const result = validateModelId("  ")
		Vitest.assert.strictEqual(Result.isFailure(result), true)
	})

	Vitest.it("accepts the external backend id", () => {
		const result = validateModelId(EXTERNAL_BACKEND_ID)
		Vitest.assert.strictEqual(Result.isSuccess(result), true)
	})
})

Vitest.describe("modelPathFor", () => {
	Vitest.it("maps every non-empty id to the external sentinel path", () => {
		const external = modelPathFor(EXTERNAL_BACKEND_ID)
		const legacy = modelPathFor("small.en")
		Vitest.assert.strictEqual(Option.isSome(external), true)
		Vitest.assert.strictEqual(Option.isSome(legacy), true)
		if (Option.isSome(external)) {
			Vitest.assert.strictEqual(external.value, EXTERNAL_BACKEND_SENTINEL_PATH)
		}
		if (Option.isSome(legacy)) {
			Vitest.assert.strictEqual(legacy.value, EXTERNAL_BACKEND_SENTINEL_PATH)
		}
	})

	Vitest.it("returns none for an empty id", () => {
		Vitest.assert.strictEqual(Option.isNone(modelPathFor("")), true)
	})
})

Vitest.describe("makeExternalModelInfo", () => {
	Vitest.it("exposes one external backend row", () => {
		const info = makeExternalModelInfo(true, false)
		Vitest.assert.strictEqual(info.id, EXTERNAL_BACKEND_ID)
		Vitest.assert.strictEqual(info.name, EXTERNAL_BACKEND_NAME)
		Vitest.assert.strictEqual(info.sizeBytes, 0)
		Vitest.assert.strictEqual(info.isDownloaded, true)
		Vitest.assert.strictEqual(info.isLoaded, false)
	})
})

Vitest.describe("listVoiceLanguages", () => {
	Vitest.it("returns auto and english", () => {
		const languages = listVoiceLanguages()
		Vitest.assert.strictEqual(languages.length, 2)
		Vitest.assert.deepStrictEqual(languages[0], { code: "auto", name: "Auto" })
		Vitest.assert.deepStrictEqual(languages[1], { code: "en", name: "English" })
	})
})
