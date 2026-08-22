import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import {
	EXTERNAL_BACKEND_ID,
	EXTERNAL_BACKEND_NAME,
	EXTERNAL_BACKEND_SENTINEL_PATH,
	MAX_SECS
} from "../Schemas.ts"
import { MicrophoneCapture, type MicrophoneCaptureShape } from "../Services/MicrophoneCapture.ts"
import { TranscriptionEngine, type TranscriptionEngineShape } from "../Services/TranscriptionEngine.ts"
import { VoiceService } from "../Services/VoiceService.ts"
import { ExternalCommandEngineLive } from "./ExternalCommandEngine.ts"
import { makeQueueMicrophoneCapture } from "./MicrophoneCapture.ts"
import { makeTrackingEngine, StubEngineLive } from "./StubEngine.ts"
import { VoiceServiceLive } from "./VoiceService.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const configLayer = (env: { readonly [key: string]: string }) =>
	ConfigProvider.layer(
		ConfigProvider.fromEnv({
			env
		})
	)

const stubVoiceLive = (capture: MicrophoneCaptureShape, env: { readonly [key: string]: string }) =>
	VoiceServiceLive.pipe(
		Layer.provide(Layer.succeed(MicrophoneCapture, capture)),
		Layer.provide(StubEngineLive),
		Layer.provide(configLayer(env))
	)

const withStubVoice = <A, E, R>(
	capture: MicrophoneCaptureShape,
	env: { readonly [key: string]: string },
	program: Effect.Effect<A, E, R | VoiceService>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(stubVoiceLive(capture, env))
	)

const withTrackingVoice = <A, E, R>(
	capture: MicrophoneCaptureShape,
	engine: TranscriptionEngineShape,
	program: Effect.Effect<A, E, R | VoiceService>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(
			VoiceServiceLive.pipe(
				Layer.provide(Layer.succeed(MicrophoneCapture, capture)),
				Layer.provide(Layer.succeed(TranscriptionEngine, engine)),
				Layer.provide(configLayer({}))
			)
		)
	)

const withExternalVoice = <A, E, R>(
	capture: MicrophoneCaptureShape,
	env: { readonly [key: string]: string },
	program: Effect.Effect<A, E, R | VoiceService>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(
			VoiceServiceLive.pipe(
				Layer.provide(Layer.succeed(MicrophoneCapture, capture)),
				Layer.provide(ExternalCommandEngineLive),
				Layer.provide(configLayer(env))
			)
		)
	)

const quietSamples = (): ReadonlyArray<number> => {
	const samples = Arr.empty<number>()
	for (let index = 0; index < 96; index = index + 1) {
		samples.push(0.004)
	}
	return samples
}

Vitest.layer(PlatformLive)("VoiceServiceLive", (it) => {
	it.effect("lists the external backend row", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const models = yield* voice.listModels()
					Vitest.assert.strictEqual(models.length, 1)
					Vitest.assert.strictEqual(models[0]?.id, EXTERNAL_BACKEND_ID)
					Vitest.assert.strictEqual(models[0]?.name, EXTERNAL_BACKEND_NAME)
					Vitest.assert.strictEqual(models[0]?.isDownloaded, false)
					Vitest.assert.strictEqual(models[0]?.isLoaded, false)
				})
			)
		})
	)

	it.effect("lists auto and english languages", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const languages = yield* voice.listLanguages()
					Vitest.assert.deepStrictEqual(languages, [
						{ code: "auto", name: "Auto" },
						{ code: "en", name: "English" }
					])
				})
			)
		})
	)

	it.effect("accepts a legacy selected model id as the external backend", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const info = yield* voice.getModelStatus("small.en")
					Vitest.assert.strictEqual(info.id, EXTERNAL_BACKEND_ID)
				})
			)
		})
	)

	it.effect("rejects an empty model id", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const error = yield* Effect.flip(voice.getModelStatus("  "))
					Vitest.assert.strictEqual(error._tag, "VoiceUnknownBackendError")
				})
			)
		})
	)

	it.effect("download fails with the external-management message", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const error = yield* Effect.flip(voice.downloadModel(EXTERNAL_BACKEND_ID))
					Vitest.assert.strictEqual(error._tag, "VoiceModelsExternalError")
					Vitest.assert.strictEqual(
						error.message.includes("ACEPE_VOICE_STT_COMMAND"),
						true
					)
				})
			)
		})
	)

	it.effect("delete is a no-op for the external backend", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					yield* voice.deleteModel(EXTERNAL_BACKEND_ID)
				})
			)
		})
	)

	it.effect("skips reloading the same sentinel path", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			const loads = yield* Ref.make<ReadonlyArray<string>>([])
			const unloads = yield* Ref.make(0)
			const engine = yield* makeTrackingEngine(loads, unloads)
			yield* withTrackingVoice(
				mic.capture,
				engine,
				Effect.gen(function*() {
					const voice = yield* VoiceService
					yield* voice.loadModel(EXTERNAL_BACKEND_ID)
					yield* voice.loadModel("small.en")
				})
			)
			Vitest.assert.deepStrictEqual(yield* Ref.get(loads), [EXTERNAL_BACKEND_SENTINEL_PATH])
		})
	)

	it.effect("marks the model loaded after load when the STT command exists", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = path.join(dir, "stt.sh")
			yield* fs.writeFileString(scriptPath, "#!/bin/sh\nprintf '{}'\n")
			yield* fs.chmod(scriptPath, 0o755)
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{ ACEPE_VOICE_STT_COMMAND: scriptPath },
				Effect.gen(function*() {
					const voice = yield* VoiceService
					yield* voice.loadModel(EXTERNAL_BACKEND_ID)
					const status = yield* voice.getModelStatus(EXTERNAL_BACKEND_ID)
					Vitest.assert.strictEqual(status.isDownloaded, true)
					Vitest.assert.strictEqual(status.isLoaded, true)
				})
			)
		})
	)

	it.effect("stop when idle returns an empty transcription", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const result = yield* voice.stopRecording("session-99", null)
					Vitest.assert.strictEqual(result.text, "")
					Vitest.assert.strictEqual(result.language, null)
					Vitest.assert.strictEqual(result.durationMs, 0)
				})
			)
		})
	)

	it.effect("cancel when idle is idempotent", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					yield* voice.cancelRecording("session-99")
					yield* voice.cancelRecording("session-99")
					yield* voice.cancelRecording("session-99")
				})
			)
		})
	)

	it.effect("rejects a second start while recording", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					yield* voice.startRecording("session-1")
					const error = yield* Effect.flip(voice.startRecording("session-2"))
					Vitest.assert.strictEqual(error._tag, "VoiceAlreadyRecordingError")
					yield* voice.cancelRecording("session-1")
				})
			)
		})
	)

	it.effect("records, emits amplitude, and transcribes on stop", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const collected = yield* voice.events.pipe(
						Stream.take(2),
						Stream.runCollect,
						Effect.forkChild
					)
					yield* voice.startRecording("session-1")
					yield* mic.push(quietSamples())
					yield* TestClock.adjust(Duration.millis(50))
					const result = yield* voice.stopRecording("session-1", null)
					Vitest.assert.strictEqual(result.text, "")
					const events = yield* Fiber.join(collected)
					Vitest.assert.strictEqual(events[0]?._tag, "VoiceAmplitude")
					Vitest.assert.strictEqual(events[1]?._tag, "VoiceTranscriptionComplete")
				})
			)
		})
	)

	it.effect("emits a recording error at the 10 minute limit", () =>
		Effect.gen(function*() {
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withStubVoice(
				mic.capture,
				{},
				Effect.gen(function*() {
					const voice = yield* VoiceService
					const collected = yield* voice.events.pipe(
						Stream.take(1),
						Stream.runCollect,
						Effect.forkChild
					)
					yield* voice.startRecording("session-1")
					yield* TestClock.adjust(Duration.seconds(MAX_SECS + 1))
					const events = yield* Fiber.join(collected)
					Vitest.assert.strictEqual(events[0]?._tag, "VoiceRecordingError")
					if (events[0]?._tag === "VoiceRecordingError") {
						Vitest.assert.strictEqual(
							events[0].message,
							"Recording stopped: exceeded 10 minute limit"
						)
					}
				})
			)
		})
	)

	it.effect("transcribes captured audio through the external STT command", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = path.join(dir, "stt.sh")
			yield* fs.writeFileString(
				scriptPath,
				`#!/bin/sh
test -f "$ACEPE_VOICE_AUDIO_PATH" || exit 17
printf '{"text":"hello from external","language":"en"}'
`
			)
			yield* fs.chmod(scriptPath, 0o755)
			const mic = yield* makeQueueMicrophoneCapture()
			yield* withExternalVoice(
				mic.capture,
				{ ACEPE_VOICE_STT_COMMAND: scriptPath },
				Effect.gen(function*() {
					const voice = yield* VoiceService
					yield* voice.loadModel(EXTERNAL_BACKEND_ID)
					yield* voice.startRecording("session-1")
					yield* mic.push([0, 0.25, -0.25])
					const result = yield* voice.stopRecording("session-1", "en")
					Vitest.assert.strictEqual(result.text, "hello from external")
					Vitest.assert.strictEqual(result.language, "en")
				})
			)
		})
	)
})
