import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { EXTERNAL_BACKEND_ID } from "../Schemas.ts"
import { VoiceService } from "../Services/VoiceService.ts"
import { VoiceRuntimeLive } from "./VoiceRuntime.ts"

const PlatformLive = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const VoiceLive = VoiceRuntimeLive.pipe(
	Layer.provideMerge(PlatformLive),
	Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))
)

Vitest.layer(Layer.fresh(VoiceLive))("VoiceRuntimeLive", (it) => {
	it.effect("provides VoiceService that lists the external backend", () =>
		Effect.gen(function*() {
			const voice = yield* VoiceService
			const models = yield* voice.listModels()
			Vitest.assert.strictEqual(models[0]?.id, EXTERNAL_BACKEND_ID)
		})
	)
})
