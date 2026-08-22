import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	ExternalSttCommandError,
	ExternalSttCommandMissingError,
	ExternalSttNotConfiguredError,
	ExternalSttNotLoadedError
} from "../Errors.ts"
import {
	EXTERNAL_STT_AUDIO_PATH_ENV,
	EXTERNAL_STT_COMMAND_ENV,
	EXTERNAL_STT_LANGUAGE_ENV,
	EXTERNAL_STT_MODEL_PATH_ENV
} from "../Schemas.ts"
import { encodeWavI16Mono, parseExternalCommandStdout } from "../audio.ts"
import { TranscriptionEngine } from "../Services/TranscriptionEngine.ts"

type ExternalCommandConfig = {
	readonly command: string
	readonly modelPath: Option.Option<string>
}

const collectOutput = Effect.fn("ExternalCommandEngine.collectOutput")(function*(
	handle: ChildProcessSpawner.ChildProcessHandle
) {
	const [stdout, stderr] = yield* Effect.zip(
		handle.stdout.pipe(Stream.decodeText, Stream.mkString),
		handle.stderr.pipe(Stream.decodeText, Stream.mkString),
		{ concurrent: true }
	)
	const exitCode = yield* handle.exitCode
	return {
		stdout,
		stderr,
		exitCode
	}
})

const optionalEnv = (name: string) =>
	Config.option(Config.string(name)).pipe(Effect.orElseSucceed(() => Option.none<string>()))

const resolveCommandConfig = Effect.fn("ExternalCommandEngine.resolveCommandConfig")(function*(
	fs: FileSystem.FileSystem,
	command: Option.Option<string>,
	modelPathRaw: Option.Option<string>
) {
	if (Option.isNone(command)) {
		return yield* new ExternalSttNotConfiguredError({ commandEnv: EXTERNAL_STT_COMMAND_ENV })
	}
	const exists = yield* fs.exists(command.value)
	if (exists === false) {
		return yield* new ExternalSttCommandMissingError({
			commandEnv: EXTERNAL_STT_COMMAND_ENV,
			path: command.value
		})
	}
	const modelPath = Option.filter(modelPathRaw, (value) => Str.trim(value).length > 0)
	return {
		command: command.value,
		modelPath
	} satisfies ExternalCommandConfig
})

export const makeExternalCommandEngine = Effect.fn("ExternalCommandEngine.make")(function*() {
	const fs = yield* FileSystem.FileSystem
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const command = yield* optionalEnv(EXTERNAL_STT_COMMAND_ENV)
	const modelPathRaw = yield* optionalEnv(EXTERNAL_STT_MODEL_PATH_ENV)
	const loaded = yield* Ref.make(Option.none<ExternalCommandConfig>())

	const loadModel = Effect.fn("ExternalCommandEngine.loadModel")(function*(_path: string) {
		const config = yield* resolveCommandConfig(fs, command, modelPathRaw)
		yield* Ref.set(loaded, Option.some(config))
	})

	const unloadModel = Effect.fn("ExternalCommandEngine.unloadModel")(function*() {
		yield* Ref.set(loaded, Option.none())
	})

	const transcribe = Effect.fn("ExternalCommandEngine.transcribe")(function*(
		audio: ReadonlyArray<number>,
		sampleRate: number,
		language: string | null
	) {
		const config = yield* Ref.get(loaded)
		if (Option.isNone(config)) {
			return yield* new ExternalSttNotLoadedError({})
		}
		const wavPath = yield* fs.makeTempFile({ prefix: "acepe-voice-", suffix: ".wav" })
		const run = Effect.fn("ExternalCommandEngine.runCommand")(function*() {
			yield* fs.writeFile(wavPath, encodeWavI16Mono(audio, sampleRate))
			const withModel = Option.match(config.value.modelPath, {
				onNone: () => Arr.of([EXTERNAL_STT_AUDIO_PATH_ENV, wavPath] as const),
				onSome: (modelPath) =>
					Arr.make(
						[EXTERNAL_STT_AUDIO_PATH_ENV, wavPath] as const,
						[EXTERNAL_STT_MODEL_PATH_ENV, modelPath] as const
					)
			})
			const envEntries =
				language === null
					? withModel
					: Arr.append(withModel, [EXTERNAL_STT_LANGUAGE_ENV, language] as const)
			const result = yield* Effect.scoped(
				spawner
					.spawn(
						ChildProcess.make(config.value.command, Arr.empty(), {
							env: Rec.fromEntries(envEntries),
							extendEnv: true
						})
					)
					.pipe(Effect.flatMap(collectOutput))
			)
			if (result.exitCode !== 0) {
				return yield* new ExternalSttCommandError({
					command: config.value.command,
					exitCode: result.exitCode,
					stderr: Str.trim(result.stderr)
				})
			}
			return parseExternalCommandStdout(result.stdout)
		})
		return yield* run().pipe(Effect.ensuring(fs.remove(wavPath, { force: true }).pipe(Effect.ignore)))
	})

	return TranscriptionEngine.of({
		loadModel,
		unloadModel,
		transcribe
	})
})

export const ExternalCommandEngineLive = Layer.effect(TranscriptionEngine, makeExternalCommandEngine())
