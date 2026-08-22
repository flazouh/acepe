import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { EXTERNAL_BACKEND_SENTINEL_PATH } from "../Schemas.ts"
import { TranscriptionEngine } from "../Services/TranscriptionEngine.ts"
import { ExternalCommandEngineLive } from "./ExternalCommandEngine.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const writeSttScript = Effect.fn("writeSttScript")(function*(directory: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const scriptPath = path.join(directory, "stt.sh")
	yield* fs.writeFileString(
		scriptPath,
		`#!/bin/sh
test -f "$ACEPE_VOICE_AUDIO_PATH" || exit 17
printf '{"text":"hello from external","language":"en"}'
`
	)
	yield* fs.chmod(scriptPath, 0o755)
	return scriptPath
})

const withEngine = <A, E, R>(
	env: { readonly [key: string]: string },
	program: Effect.Effect<A, E, R | TranscriptionEngine>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(
			ExternalCommandEngineLive.pipe(
				Layer.provide(
					ConfigProvider.layer(
						ConfigProvider.fromEnv({
							env
						})
					)
				)
			)
		)
	)

Vitest.layer(PlatformLive)("ExternalCommandEngineLive", (it) => {
	it.effect("fails transcribe when the backend is not loaded", () =>
		withEngine(
			{},
			Effect.gen(function*() {
				const engine = yield* TranscriptionEngine
				const error = yield* Effect.flip(engine.transcribe([0, 0.25], 16_000, null))
				Vitest.assert.strictEqual(error._tag, "ExternalSttNotLoadedError")
			})
		)
	)

	it.effect("fails load when the STT command env is missing", () =>
		withEngine(
			{},
			Effect.gen(function*() {
				const engine = yield* TranscriptionEngine
				const error = yield* Effect.flip(engine.loadModel(EXTERNAL_BACKEND_SENTINEL_PATH))
				Vitest.assert.strictEqual(error._tag, "ExternalSttNotConfiguredError")
			})
		)
	)

	it.effect("transcribes with the audio path env", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = yield* writeSttScript(dir)
			yield* withEngine(
				{ ACEPE_VOICE_STT_COMMAND: scriptPath },
				Effect.gen(function*() {
					const engine = yield* TranscriptionEngine
					yield* engine.loadModel(EXTERNAL_BACKEND_SENTINEL_PATH)
					const result = yield* engine.transcribe([0, 0.25, -0.25], 16_000, "en")
					Vitest.assert.strictEqual(result.text, "hello from external")
					Vitest.assert.strictEqual(result.language, "en")
				})
			)
		})
	)

	it.effect("fails when the STT command exits non-zero", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = path.join(dir, "fail.sh")
			yield* fs.writeFileString(scriptPath, "#!/bin/sh\nexit 17\n")
			yield* fs.chmod(scriptPath, 0o755)
			yield* withEngine(
				{ ACEPE_VOICE_STT_COMMAND: scriptPath },
				Effect.gen(function*() {
					const engine = yield* TranscriptionEngine
					yield* engine.loadModel(EXTERNAL_BACKEND_SENTINEL_PATH)
					const error = yield* Effect.flip(engine.transcribe([0], 16_000, null))
					Vitest.assert.strictEqual(error._tag, "ExternalSttCommandError")
					if (error._tag === "ExternalSttCommandError") {
						Vitest.assert.strictEqual(error.exitCode, 17)
					}
				})
			)
		})
	)
})
