import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	FAKE_AUDIO_CHUNK_SAMPLES,
	makeFakeAudioMicrophoneCapture
} from "./FakeAudioMicrophoneCapture.ts"

Vitest.describe("FakeAudioMicrophoneCapture", () => {
	Vitest.it.effect("starts without a permission check and never fails", () =>
		Effect.gen(function*() {
			const mic = yield* makeFakeAudioMicrophoneCapture()
			const session = yield* mic.capture.start()
			Vitest.assert.strictEqual(session.sampleRate, 48_000)
		})
	)

	Vitest.it.effect("generates non-silent samples on every pull, unlike the queue capture", () =>
		Effect.gen(function*() {
			const mic = yield* makeFakeAudioMicrophoneCapture()
			const session = yield* mic.capture.start()

			const first = yield* session.pull()
			Vitest.assert.strictEqual(first.length, FAKE_AUDIO_CHUNK_SAMPLES)
			Vitest.assert.strictEqual(
				first.some((sample) => sample !== 0),
				true
			)

			const second = yield* session.pull()
			Vitest.assert.strictEqual(second.length, FAKE_AUDIO_CHUNK_SAMPLES)
			// Successive chunks continue the waveform rather than repeating it.
			Vitest.assert.isFalse(first.every((sample, index) => sample === second[index]))
		})
	)

	Vitest.it.effect("never reports a device error", () =>
		Effect.gen(function*() {
			const mic = yield* makeFakeAudioMicrophoneCapture()
			const session = yield* mic.capture.start()
			const error = yield* session.takeError()
			Vitest.assert.strictEqual(error._tag, "None")
			yield* session.stop()
		})
	)
})
