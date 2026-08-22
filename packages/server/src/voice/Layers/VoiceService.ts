import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as SynchronizedRef from "effect/SynchronizedRef"
import {
	VoiceAlreadyRecordingError,
	VoiceBackendAlreadyConfiguringError,
	VoiceModelsExternalError,
	VoiceUnknownModelError
} from "../Errors.ts"
import {
	EXTERNAL_STT_COMMAND_ENV,
	EXTERNAL_STT_MODEL_PATH_ENV,
	MAX_SECS,
	NonNegativeInt,
	type TranscriptionResult,
	type VoiceEvent,
	VoiceAmplitudeEvent,
	VoiceLanguageOption as VoiceLanguageOptionSchema,
	VoiceModelDownloadErrorEvent,
	VoiceModelInfo as VoiceModelInfoSchema,
	VoiceRecordingErrorEvent,
	VoiceTranscriptionCompleteEvent,
	VoiceTranscriptionErrorEvent,
	WARN_SECS,
	WHISPER_SAMPLE_RATE,
	WORKER_TICK_MS,
	emptyTranscriptionResult
} from "../Schemas.ts"
import {
	computeAmplitudeBatch,
	normalizeAudioForTranscription,
	resample,
	zeroize
} from "../audio.ts"
import { listVoiceLanguages, makeExternalModelInfo, modelPathFor, validateModelId } from "../models.ts"
import { type CaptureSession, MicrophoneCapture } from "../Services/MicrophoneCapture.ts"
import { TranscriptionEngine } from "../Services/TranscriptionEngine.ts"
import { VoiceService } from "../Services/VoiceService.ts"

const decodeModels = Schema.decodeUnknownEffect(Schema.Array(VoiceModelInfoSchema))
const decodeLanguages = Schema.decodeUnknownEffect(Schema.Array(VoiceLanguageOptionSchema))
const decodeModel = Schema.decodeUnknownEffect(VoiceModelInfoSchema)
const decodeDuration = Schema.decodeUnknownEffect(NonNegativeInt)

type RecordingSession = {
	readonly sessionId: string
	readonly sampleRate: number
	readonly startedAtMs: number
	readonly capture: CaptureSession
	readonly accumulated: Array<number>
	readonly warned: boolean
}

type WorkerState =
	| { readonly _tag: "Idle" }
	| { readonly _tag: "Recording"; readonly session: RecordingSession }

type TickOutcome =
	| { readonly _tag: "None" }
	| { readonly _tag: "Amplitude"; readonly event: VoiceAmplitudeEvent }
	| { readonly _tag: "StopError"; readonly session: RecordingSession; readonly message: string }
	| { readonly _tag: "StopLimit"; readonly session: RecordingSession }

const idleState: WorkerState = { _tag: "Idle" }
const noneTick: TickOutcome = { _tag: "None" }

const appendSamples = (target: Array<number>, chunk: ReadonlyArray<number>): void => {
	for (const sample of chunk) {
		target.push(sample)
	}
}

export const makeVoiceService = Effect.fn("VoiceService.make")(function*() {
	const fs = yield* FileSystem.FileSystem
	const engine = yield* TranscriptionEngine
	const microphone = yield* MicrophoneCapture
	const workerState = yield* SynchronizedRef.make<WorkerState>(idleState)
	const loadedModelPath = yield* Ref.make(Option.none<string>())
	const downloading = yield* Ref.make(HashSet.empty<string>())
	const eventPubSub = yield* PubSub.unbounded<VoiceEvent>()
	const sttCommand = yield* Config.option(Config.string(EXTERNAL_STT_COMMAND_ENV)).pipe(
		Effect.orElseSucceed(() => Option.none<string>())
	)

	const sttCommandConfigured = Effect.fn("VoiceService.sttCommandConfigured")(function*() {
		if (Option.isNone(sttCommand) || Str.trim(sttCommand.value).length === 0) {
			return false
		}
		return yield* fs.exists(sttCommand.value)
	})

	const publish = Effect.fn("VoiceService.publish")(function*(event: VoiceEvent) {
		yield* PubSub.publish(eventPubSub, event)
	})

	const listModels = Effect.fn("VoiceService.listModels")(function*() {
		const isDownloaded = yield* sttCommandConfigured()
		const row = makeExternalModelInfo(isDownloaded, false)
		return yield* decodeModels([row])
	})

	const listLanguages = Effect.fn("VoiceService.listLanguages")(function*() {
		return yield* decodeLanguages(listVoiceLanguages())
	})

	const getModelStatus = Effect.fn("VoiceService.getModelStatus")(function*(modelId: string) {
		const validated = validateModelId(modelId)
		if (Result.isFailure(validated)) {
			return yield* validated.failure
		}
		const isDownloaded = yield* sttCommandConfigured()
		const path = modelPathFor(modelId)
		if (Option.isNone(path)) {
			return yield* new VoiceUnknownModelError({ modelId })
		}
		const loaded = yield* Ref.get(loadedModelPath)
		const isLoaded =
			isDownloaded === true && Option.isSome(loaded) && loaded.value === path.value
		return yield* decodeModel(makeExternalModelInfo(isDownloaded, isLoaded))
	})

	const downloadModel = Effect.fn("VoiceService.downloadModel")(function*(modelId: string) {
		const validated = validateModelId(modelId)
		if (Result.isFailure(validated)) {
			return yield* validated.failure
		}
		const inserted = yield* Ref.modify(downloading, (set) => {
			if (HashSet.has(set, modelId) === true) {
				return [false, set]
			}
			return [true, HashSet.add(set, modelId)]
		})
		if (inserted === false) {
			return yield* new VoiceBackendAlreadyConfiguringError({ modelId })
		}
		yield* Ref.update(downloading, (set) => HashSet.remove(set, modelId))
		const error = new VoiceModelsExternalError({
			commandEnv: EXTERNAL_STT_COMMAND_ENV,
			modelPathEnv: EXTERNAL_STT_MODEL_PATH_ENV
		})
		yield* publish(
			new VoiceModelDownloadErrorEvent({
				modelId,
				message: error.message
			})
		)
		return yield* error
	})

	const deleteModel = Effect.fn("VoiceService.deleteModel")(function*(modelId: string) {
		const validated = validateModelId(modelId)
		if (Result.isFailure(validated)) {
			return yield* validated.failure
		}
		return yield* Effect.void
	})

	const loadModel = Effect.fn("VoiceService.loadModel")(function*(modelId: string) {
		const validated = validateModelId(modelId)
		if (Result.isFailure(validated)) {
			return yield* validated.failure
		}
		const path = modelPathFor(modelId)
		if (Option.isNone(path)) {
			return yield* new VoiceUnknownModelError({ modelId })
		}
		const loaded = yield* Ref.get(loadedModelPath)
		if (Option.isSome(loaded) && loaded.value === path.value) {
			return yield* Effect.void
		}
		const outcome = yield* Effect.result(engine.loadModel(path.value))
		if (Result.isFailure(outcome)) {
			yield* Ref.set(loadedModelPath, Option.none())
			return yield* outcome.failure
		}
		yield* Ref.set(loadedModelPath, Option.some(path.value))
	})

	const beginRecording = Effect.fn("VoiceService.beginRecording")(function*(
		current: WorkerState,
		sessionId: string
	) {
		if (current._tag === "Recording") {
			return yield* new VoiceAlreadyRecordingError({})
		}
		const capture = yield* microphone.start()
		const startedAtMs = yield* Clock.currentTimeMillis
		const session: RecordingSession = {
			sessionId,
			sampleRate: capture.sampleRate,
			startedAtMs,
			capture,
			accumulated: Arr.empty(),
			warned: false
		}
		const next: WorkerState = { _tag: "Recording", session }
		return next
	})

	const startRecording = Effect.fn("VoiceService.startRecording")(function*(sessionId: string) {
		yield* SynchronizedRef.updateEffect(workerState, (current) => beginRecording(current, sessionId))
	})

	const takeMatchingSession = (
		current: WorkerState,
		sessionId: string
	): readonly [Option.Option<RecordingSession>, WorkerState] => {
		if (current._tag === "Recording" && current.session.sessionId === sessionId) {
			return [Option.some(current.session), idleState]
		}
		return [Option.none(), current]
	}

	const finishRecording = Effect.fn("VoiceService.finishRecording")(function*(
		session: RecordingSession,
		language: string | null
	) {
		yield* session.capture.stop()
		const remaining = yield* session.capture.pull()
		appendSamples(session.accumulated, remaining)
		const now = yield* Clock.currentTimeMillis
		const elapsed = Math.max(0, Math.trunc(now - session.startedAtMs))
		const audio16k = resample(session.accumulated, session.sampleRate, WHISPER_SAMPLE_RATE)
		const normalized = normalizeAudioForTranscription(audio16k)
		zeroize(session.accumulated)
		const outcome = yield* Effect.result(
			engine.transcribe(normalized, WHISPER_SAMPLE_RATE, language)
		)
		if (Result.isFailure(outcome)) {
			yield* publish(
				new VoiceTranscriptionErrorEvent({
					sessionId: session.sessionId,
					message: outcome.failure.message
				})
			)
			return yield* outcome.failure
		}
		const durationMs =
			outcome.success.durationMs === 0
				? yield* decodeDuration(elapsed)
				: outcome.success.durationMs
		const result: TranscriptionResult = {
			text: outcome.success.text,
			language: outcome.success.language,
			durationMs
		}
		yield* publish(
			new VoiceTranscriptionCompleteEvent({
				sessionId: session.sessionId,
				text: result.text,
				language: result.language,
				durationMs: result.durationMs
			})
		)
		return result
	})

	const stopRecording = Effect.fn("VoiceService.stopRecording")(function*(
		sessionId: string,
		language: string | null
	) {
		const taken = yield* SynchronizedRef.modify(workerState, (current) =>
			takeMatchingSession(current, sessionId)
		)
		if (Option.isNone(taken)) {
			yield* publish(
				new VoiceTranscriptionCompleteEvent({
					sessionId,
					text: "",
					language: null,
					durationMs: 0
				})
			)
			return emptyTranscriptionResult
		}
		return yield* finishRecording(taken.value, language)
	})

	const cancelRecording = Effect.fn("VoiceService.cancelRecording")(function*(sessionId: string) {
		const taken = yield* SynchronizedRef.modify(workerState, (current) =>
			takeMatchingSession(current, sessionId)
		)
		if (Option.isSome(taken)) {
			yield* taken.value.capture.stop()
			zeroize(taken.value.accumulated)
		}
	})

	const tickPair = (
		outcome: TickOutcome,
		next: WorkerState
	): readonly [TickOutcome, WorkerState] => [outcome, next]

	const tickModify = Effect.fn("VoiceService.tickModify")(function*(current: WorkerState) {
		if (current._tag !== "Recording") {
			return tickPair(noneTick, current)
		}
		const deviceError = yield* current.session.capture.takeError()
		if (Option.isSome(deviceError)) {
			const outcome: TickOutcome = {
				_tag: "StopError",
				session: current.session,
				message: deviceError.value
			}
			return tickPair(outcome, idleState)
		}
		const now = yield* Clock.currentTimeMillis
		const elapsedSecs = Math.trunc((now - current.session.startedAtMs) / 1000)
		if (elapsedSecs >= MAX_SECS) {
			const outcome: TickOutcome = { _tag: "StopLimit", session: current.session }
			return tickPair(outcome, idleState)
		}
		const chunk = yield* current.session.capture.pull()
		appendSamples(current.session.accumulated, chunk)
		let warned = current.session.warned
		if (elapsedSecs >= WARN_SECS && elapsedSecs < WARN_SECS + 1 && warned === false) {
			yield* Effect.logWarning("Voice recording approaching 8 minute limit")
			warned = true
		}
		const next: WorkerState = {
			_tag: "Recording",
			session: {
				sessionId: current.session.sessionId,
				sampleRate: current.session.sampleRate,
				startedAtMs: current.session.startedAtMs,
				capture: current.session.capture,
				accumulated: current.session.accumulated,
				warned
			}
		}
		if (chunk.length === 0) {
			return tickPair(noneTick, next)
		}
		const amplitude: TickOutcome = {
			_tag: "Amplitude",
			event: new VoiceAmplitudeEvent({
				sessionId: current.session.sessionId,
				values: computeAmplitudeBatch(chunk)
			})
		}
		return tickPair(amplitude, next)
	})

	const cleanupStoppedSession = Effect.fn("VoiceService.cleanupStoppedSession")(function*(
		session: RecordingSession
	) {
		yield* session.capture.stop()
		zeroize(session.accumulated)
	})

	const tickOnce = Effect.fn("VoiceService.tickOnce")(function*() {
		const outcome = yield* SynchronizedRef.modifyEffect(workerState, (current) => tickModify(current))
		if (outcome._tag === "Amplitude") {
			yield* publish(outcome.event)
			return
		}
		if (outcome._tag === "StopError") {
			yield* cleanupStoppedSession(outcome.session)
			yield* publish(
				new VoiceRecordingErrorEvent({
					sessionId: outcome.session.sessionId,
					message: outcome.message
				})
			)
			return
		}
		if (outcome._tag === "StopLimit") {
			yield* cleanupStoppedSession(outcome.session)
			yield* publish(
				new VoiceRecordingErrorEvent({
					sessionId: outcome.session.sessionId,
					message: `Recording stopped: exceeded ${String(MAX_SECS / 60)} minute limit`
				})
			)
		}
	})

	const worker = Effect.sleep(Duration.millis(WORKER_TICK_MS)).pipe(
		Effect.andThen(
			tickOnce().pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("voice tick failed").pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) })
					)
				)
			)
		),
		Effect.forever
	)
	yield* Effect.forkScoped(worker)
	yield* Effect.addFinalizer(() =>
		Effect.uninterruptible(
			Effect.gen(function*() {
				const current = yield* SynchronizedRef.get(workerState)
				if (current._tag === "Recording") {
					yield* cleanupStoppedSession(current.session).pipe(Effect.ignore)
				}
				yield* SynchronizedRef.set(workerState, idleState)
				const loaded = yield* Ref.get(loadedModelPath)
				if (Option.isSome(loaded)) {
					yield* engine.unloadModel()
					yield* Ref.set(loadedModelPath, Option.none())
				}
				yield* PubSub.shutdown(eventPubSub)
			})
		)
	)

	return VoiceService.of({
		listModels,
		listLanguages,
		getModelStatus,
		downloadModel,
		deleteModel,
		loadModel,
		startRecording,
		stopRecording,
		cancelRecording,
		get events() {
			return Stream.fromPubSub(eventPubSub)
		}
	})
})

export const VoiceServiceLive = Layer.effect(VoiceService, makeVoiceService())
