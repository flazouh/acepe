import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import { emptyTranscriptionResult } from "../Schemas.ts"
import { TranscriptionEngine } from "../Services/TranscriptionEngine.ts"

export const makeStubEngine = Effect.fn("StubEngine.make")(function*() {
	return TranscriptionEngine.of({
		loadModel: Effect.fn("StubEngine.loadModel")(function*(_path: string) {
			return yield* Effect.void
		}),
		unloadModel: Effect.fn("StubEngine.unloadModel")(function*() {
			return yield* Effect.void
		}),
		transcribe: Effect.fn("StubEngine.transcribe")(function*(
			_audio: ReadonlyArray<number>,
			_sampleRate: number,
			_language: string | null
		) {
			return emptyTranscriptionResult
		})
	})
})

export const StubEngineLive = Layer.effect(TranscriptionEngine, makeStubEngine())

export const makeTrackingEngine = Effect.fn("TrackingEngine.make")(function*(
	loads: Ref.Ref<ReadonlyArray<string>>,
	unloads: Ref.Ref<number>
) {
	return TranscriptionEngine.of({
		loadModel: Effect.fn("TrackingEngine.loadModel")(function*(path: string) {
			yield* Ref.update(loads, (current) => Arr.append(current, path))
		}),
		unloadModel: Effect.fn("TrackingEngine.unloadModel")(function*() {
			yield* Ref.update(unloads, (count) => count + 1)
		}),
		transcribe: Effect.fn("TrackingEngine.transcribe")(function*(
			_audio: ReadonlyArray<number>,
			_sampleRate: number,
			_language: string | null
		) {
			return emptyTranscriptionResult
		})
	})
})
