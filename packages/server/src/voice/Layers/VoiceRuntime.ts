import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { ExternalCommandEngineLive } from "./ExternalCommandEngine.ts"
import { loadFakeAudioSamples, makeFakeAudioMicrophoneCapture } from "./FakeAudioMicrophoneCapture.ts"
import { makeQueueMicrophoneCapture } from "./MicrophoneCapture.ts"
import { StubEngineLive } from "./StubEngine.ts"
import { EXTERNAL_STT_COMMAND_ENV } from "../Schemas.ts"
import { VoiceServiceLive } from "./VoiceService.ts"
import { MicrophoneCapture, type MicrophoneCaptureShape } from "../Services/MicrophoneCapture.ts"

export type VoiceRuntimeOptions = {
	/**
	 * Whether the electrobun QA surface is compiled into this build (unsigned
	 * builds only — signed builds compile it out entirely). Threaded in from
	 * `qaSurfaceEnabled(resolveElectrobunConfig())` by the process entrypoint;
	 * defaults to `false` so any caller that omits it gets the production
	 * (queue/real-capture) path.
	 */
	readonly qaSurfaceEnabled: boolean
}

export type ResolvedMicrophoneCapture = {
	readonly kind: "fake" | "queue"
	readonly capture: MicrophoneCaptureShape
}

/**
 * The fake audio source is reachable only when BOTH hold: the QA surface
 * itself is compiled in (unsigned build) and the operator opts in via
 * `ELECTROBUN_QA_FAKE_AUDIO=1`. A signed build always resolves this to
 * `false`, regardless of the env flag, because `qaSurfaceEnabled` is `false`
 * there — there is no combination of env vars that reaches the fake source
 * in a shipped app.
 */
export const shouldUseFakeAudioCapture = (input: {
	readonly qaSurfaceEnabled: boolean
	readonly fakeAudioRequested: boolean
}): boolean => input.qaSurfaceEnabled === true && input.fakeAudioRequested === true

const fakeAudioRequestedConfig = Config.boolean("FAKE_AUDIO").pipe(
	Config.nested("ELECTROBUN_QA"),
	Config.withDefault(false)
)

/**
 * Picks the microphone capture backend for this process. Exposed on its own
 * (rather than folded straight into the Layer) so tests can assert which
 * backend was chosen without needing a full VoiceService.
 */
export const resolveMicrophoneCapture = Effect.fn("resolveMicrophoneCapture")(function*(
	options: VoiceRuntimeOptions
) {
	const fakeAudioRequested = yield* fakeAudioRequestedConfig
	const useFakeAudio = shouldUseFakeAudioCapture({
		qaSurfaceEnabled: options.qaSurfaceEnabled,
		fakeAudioRequested
	})
	if (useFakeAudio === true) {
		const recorded = yield* loadFakeAudioSamples()
		const mic = yield* makeFakeAudioMicrophoneCapture(recorded)
		return { kind: "fake", capture: mic.capture } satisfies ResolvedMicrophoneCapture
	}
	const mic = yield* makeQueueMicrophoneCapture()
	return { kind: "queue", capture: mic.capture } satisfies ResolvedMicrophoneCapture
})

const sttCommandConfig = Config.option(Config.string(EXTERNAL_STT_COMMAND_ENV)).pipe(
	Effect.orElseSucceed(() => Option.none<string>())
)

/**
 * The stub engine transcribes every recording to an empty string, so wiring it
 * unconditionally is what made dictation answer "no speech detected" no matter
 * what was said. The external command engine is the only one that transcribes
 * anything, and it needs a command to run, so the command is what picks it.
 */
export const resolveTranscriptionEngine = Effect.fn("resolveTranscriptionEngine")(function*() {
	const command = yield* sttCommandConfig
	if (Option.isNone(command)) {
		return { kind: "stub", layer: StubEngineLive } as const
	}
	return { kind: "external", layer: ExternalCommandEngineLive } as const
})

export const makeVoiceRuntimeLive = (options: VoiceRuntimeOptions) =>
	Layer.unwrap(
		Effect.gen(function*() {
			const resolved = yield* resolveMicrophoneCapture(options)
			const engine = yield* resolveTranscriptionEngine()
			return VoiceServiceLive.pipe(
				Layer.provide(Layer.succeed(MicrophoneCapture, resolved.capture)),
				Layer.provide(engine.layer)
			)
		})
	)

/** Default runtime: QA surface disabled, so the fake source is never reachable. */
export const VoiceRuntimeLive = makeVoiceRuntimeLive({ qaSurfaceEnabled: false })
