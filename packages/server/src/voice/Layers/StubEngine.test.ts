import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import { EXTERNAL_BACKEND_SENTINEL_PATH } from "../Schemas.ts"
import { TranscriptionEngine } from "../Services/TranscriptionEngine.ts"
import { makeTrackingEngine, StubEngineLive } from "./StubEngine.ts"

Vitest.describe("StubEngineLive", () => {
	Vitest.it.effect("returns empty transcription without loading a model", () =>
		Effect.gen(function*() {
			const engine = yield* TranscriptionEngine
			const result = yield* engine.transcribe([0.1, -0.1, 0.2], 16_000, null)
			Vitest.assert.strictEqual(result.text, "")
			Vitest.assert.strictEqual(result.language, null)
			Vitest.assert.strictEqual(result.durationMs, 0)
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(StubEngineLive)
		)
	)
})

Vitest.describe("TrackingEngine", () => {
	Vitest.it.effect("records load and unload calls", () =>
		Effect.gen(function*() {
			const loads = yield* Ref.make<ReadonlyArray<string>>([])
			const unloads = yield* Ref.make(0)
			const engine = yield* makeTrackingEngine(loads, unloads)
			yield* engine.loadModel(EXTERNAL_BACKEND_SENTINEL_PATH)
			yield* engine.unloadModel()
			Vitest.assert.deepStrictEqual(yield* Ref.get(loads), [EXTERNAL_BACKEND_SENTINEL_PATH])
			Vitest.assert.strictEqual(yield* Ref.get(unloads), 1)
		})
	)
})
