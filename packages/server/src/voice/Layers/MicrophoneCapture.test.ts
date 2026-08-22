import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { NO_MICROPHONE_MESSAGE } from "../Services/MicrophoneCapture.ts"
import { makeQueueMicrophoneCapture } from "./MicrophoneCapture.ts"

Vitest.describe("QueueMicrophoneCapture", () => {
	Vitest.it.effect("starts and pulls pushed samples", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* mic.push([0.1, 0.2])
			const session = yield* mic.capture.start()
			Vitest.assert.strictEqual(session.sampleRate, 48_000)
			const first = yield* session.pull()
			Vitest.assert.deepStrictEqual(first, [0.1, 0.2])
			const second = yield* session.pull()
			Vitest.assert.deepStrictEqual(second, [])
			yield* session.stop()
		})
	)

	Vitest.it.effect("fails start when marked unavailable", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* mic.failStart(NO_MICROPHONE_MESSAGE)
			const error = yield* Effect.flip(mic.capture.start())
			Vitest.assert.strictEqual(error._tag, "MicrophoneUnavailableError")
			Vitest.assert.strictEqual(error.message, NO_MICROPHONE_MESSAGE)
		})
	)

	Vitest.it.effect("reports a capture error once", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			const session = yield* mic.capture.start()
			yield* mic.failCapture("Microphone input failed")
			const first = yield* session.takeError()
			const second = yield* session.takeError()
			Vitest.assert.strictEqual(first._tag, "Some")
			if (first._tag === "Some") {
				Vitest.assert.strictEqual(first.value, "Microphone input failed")
			}
			Vitest.assert.strictEqual(second._tag, "None")
		})
	)
})
