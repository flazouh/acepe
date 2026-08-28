import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import { decodeWavI16Mono, resample } from "../audio.ts"
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

const audioPathConfig = Config.option(Config.string("FAKE_AUDIO_PATH")).pipe(
	Config.nested("ELECTROBUN_QA"),
	Effect.orElseSucceed(() => Option.none<string>())
)

/**
 * Reads the recording the operator pointed the fake microphone at, resampled to
 * the rate the capture pipeline carries. A tone proves dictation ran end to
 * end; only speech proves it transcribed, and a QA run cannot speak.
 *
 * An unreadable or unsupported file falls back to the tone rather than failing
 * the capture: the fake microphone is a QA convenience, and a broken path
 * should not take the app down.
 */
export const loadFakeAudioSamples = Effect.fn("FakeAudioMicrophoneCapture.loadSamples")(function*() {
	const path = yield* audioPathConfig
	if (Option.isNone(path)) {
		return Option.none<ReadonlyArray<number>>()
	}
	const fs = yield* FileSystem.FileSystem
	const bytes = yield* fs.readFile(path.value).pipe(Effect.option)
	if (Option.isNone(bytes)) {
		return Option.none<ReadonlyArray<number>>()
	}
	const decoded = decodeWavI16Mono(bytes.value)
	if (Option.isNone(decoded)) {
		return Option.none<ReadonlyArray<number>>()
	}
	return Option.some(
		resample(decoded.value.samples, decoded.value.sampleRate, DEFAULT_CAPTURE_SAMPLE_RATE)
	)
})

/**
 * The recording is passed in rather than read here, so the fake microphone
 * keeps its old shape: no filesystem, no config, nothing for a caller or a test
 * to provide. resolveMicrophoneCapture does the reading.
 */
export const makeFakeAudioMicrophoneCapture = Effect.fn("FakeAudioMicrophoneCapture.make")(function*(
	recorded: Option.Option<ReadonlyArray<number>> = Option.none()
) {
	const start = Effect.fn("FakeAudioMicrophoneCapture.start")(function*() {
		let sampleIndex = 0
		const session: CaptureSession = {
			sampleRate: DEFAULT_CAPTURE_SAMPLE_RATE,
			pull: Effect.fn("FakeAudioMicrophoneCapture.pull")(function*() {
				const chunk = Option.isSome(recorded)
					? recorded.value.slice(sampleIndex, sampleIndex + FAKE_AUDIO_CHUNK_SAMPLES)
					: generateChunk(sampleIndex, FAKE_AUDIO_CHUNK_SAMPLES)
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
