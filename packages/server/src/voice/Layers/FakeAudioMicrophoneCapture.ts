import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	type CaptureSession,
	DEFAULT_CAPTURE_SAMPLE_RATE,
	MicrophoneCapture,
	type MicrophoneCaptureShape
} from "../Services/MicrophoneCapture.ts"

/**
 * Injectable microphone capture for QA automation.
 *
 * macOS gates real microphone access behind a TCC permission prompt that
 * automation cannot click through. This capture never touches hardware: it
 * generates a deterministic tone buffer on every `pull()`, so a QA script
 * can exercise start → stop → transcription end to end without a prompt.
 *
 * Only wired in when the QA surface is enabled AND the operator opts in via
 * `ELECTROBUN_QA_FAKE_AUDIO=1` — see `resolveMicrophoneCapture` in
 * `VoiceRuntime.ts`. Signed builds compile the QA surface out, so this path
 * is unreachable there regardless of the env flag.
 */
export const FAKE_AUDIO_TONE_HZ = 440
export const FAKE_AUDIO_CHUNK_SAMPLES = 4_800 // 100ms at DEFAULT_CAPTURE_SAMPLE_RATE

const generateChunk = (startSampleIndex: number, count: number): ReadonlyArray<number> => {
	const samples: Array<number> = []
	for (let index = 0; index < count; index += 1) {
		const t = (startSampleIndex + index) / DEFAULT_CAPTURE_SAMPLE_RATE
		samples.push(Math.sin(2 * Math.PI * FAKE_AUDIO_TONE_HZ * t) * 0.2)
	}
	return samples
}

export const makeFakeAudioMicrophoneCapture = Effect.fn("FakeAudioMicrophoneCapture.make")(function*() {
	const start = Effect.fn("FakeAudioMicrophoneCapture.start")(function*() {
		let sampleIndex = 0
		const session: CaptureSession = {
			sampleRate: DEFAULT_CAPTURE_SAMPLE_RATE,
			pull: Effect.fn("FakeAudioMicrophoneCapture.pull")(function*() {
				const chunk = generateChunk(sampleIndex, FAKE_AUDIO_CHUNK_SAMPLES)
				sampleIndex += FAKE_AUDIO_CHUNK_SAMPLES
				return chunk
			}),
			takeError: Effect.fn("FakeAudioMicrophoneCapture.takeError")(function*() {
				return Option.none<string>()
			}),
			stop: Effect.fn("FakeAudioMicrophoneCapture.stop")(function*() {
				return yield* Effect.void
			})
		}
		return session
	})

	return {
		capture: MicrophoneCapture.of({ start }) satisfies MicrophoneCaptureShape
	}
})
