import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { encodeWavI16Mono } from "../audio.ts"
import {
	FAKE_AUDIO_CHUNK_SAMPLES,
	loadFakeAudioSamples,
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

Vitest.layer(BunFileSystem.layer)("FakeAudioMicrophoneCapture with a recording", (it) => {
	it.effect("plays the wav the operator pointed it at", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* fs.makeTempFile({ prefix: "fake-audio-", suffix: ".wav" })
			const tone: Array<number> = []
			for (let index = 0; index < FAKE_AUDIO_CHUNK_SAMPLES; index = index + 1) {
				tone.push(index % 2 === 0 ? 0.5 : -0.5)
			}
			yield* fs.writeFile(path, encodeWavI16Mono(tone, 48_000))

			const recorded = yield* loadFakeAudioSamples().pipe(
				Effect.provideService(
					ConfigProvider.ConfigProvider,
					ConfigProvider.fromEnv({ env: { ELECTROBUN_QA_FAKE_AUDIO_PATH: path } })
				)
			)
			const mic = yield* makeFakeAudioMicrophoneCapture(recorded)
			const session = yield* mic.capture.start()
			const first = yield* session.pull()
			Vitest.assert.strictEqual(first.length, FAKE_AUDIO_CHUNK_SAMPLES)
			Vitest.assert.strictEqual(Math.abs(first[0] ?? 0) > 0.4, true)

			// The recording runs out; the capture stops producing rather than
			// looping, which is what lets a QA run read one transcript and stop.
			const second = yield* session.pull()
			Vitest.assert.strictEqual(second.length, 0)
			yield* fs.remove(path, { force: true })
		})
	)
})
