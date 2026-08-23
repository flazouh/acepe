import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { EXTERNAL_BACKEND_ID } from "../Schemas.ts"
import { VoiceService } from "../Services/VoiceService.ts"
import { resolveMicrophoneCapture, shouldUseFakeAudioCapture, VoiceRuntimeLive } from "./VoiceRuntime.ts"

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

Vitest.describe("shouldUseFakeAudioCapture", () => {
	Vitest.it("is unreachable when the QA surface is disabled, even if the flag is set", () => {
		Vitest.assert.strictEqual(
			shouldUseFakeAudioCapture({ qaSurfaceEnabled: false, fakeAudioRequested: true }),
			false
		)
	})

	Vitest.it("stays off when the QA surface is enabled but the flag is unset", () => {
		Vitest.assert.strictEqual(
			shouldUseFakeAudioCapture({ qaSurfaceEnabled: true, fakeAudioRequested: false }),
			false
		)
	})

	Vitest.it("is off when both are disabled", () => {
		Vitest.assert.strictEqual(
			shouldUseFakeAudioCapture({ qaSurfaceEnabled: false, fakeAudioRequested: false }),
			false
		)
	})

	Vitest.it("turns on only when both the QA surface and the flag are set", () => {
		Vitest.assert.strictEqual(
			shouldUseFakeAudioCapture({ qaSurfaceEnabled: true, fakeAudioRequested: true }),
			true
		)
	})
})

Vitest.layer(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ELECTROBUN_QA_FAKE_AUDIO: "1" } })))(
	"resolveMicrophoneCapture, QA surface disabled, flag set",
	(it) => {
		it.effect("never selects the fake source when the QA surface is disabled", () =>
			Effect.gen(function*() {
				const resolved = yield* resolveMicrophoneCapture({ qaSurfaceEnabled: false })
				Vitest.assert.strictEqual(resolved.kind, "queue")
			})
		)
	}
)

Vitest.layer(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))(
	"resolveMicrophoneCapture, QA surface enabled, flag unset",
	(it) => {
		it.effect("stays on the queue capture", () =>
			Effect.gen(function*() {
				const resolved = yield* resolveMicrophoneCapture({ qaSurfaceEnabled: true })
				Vitest.assert.strictEqual(resolved.kind, "queue")
			})
		)

		it.effect("the queue capture starts silent — nothing has been pushed into it", () =>
			Effect.gen(function*() {
				const resolved = yield* resolveMicrophoneCapture({ qaSurfaceEnabled: false })
				Vitest.assert.strictEqual(resolved.kind, "queue")
				const session = yield* resolved.capture.start()
				const samples = yield* session.pull()
				Vitest.assert.deepStrictEqual(samples, [])
			})
		)
	}
)

Vitest.layer(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ELECTROBUN_QA_FAKE_AUDIO: "1" } })))(
	"resolveMicrophoneCapture, QA surface enabled, flag set",
	(it) => {
		it.effect("selects the fake source, which yields real generated samples", () =>
			Effect.gen(function*() {
				const resolved = yield* resolveMicrophoneCapture({ qaSurfaceEnabled: true })
				Vitest.assert.strictEqual(resolved.kind, "fake")
				const session = yield* resolved.capture.start()
				const samples = yield* session.pull()
				Vitest.assert.strictEqual(samples.length > 0, true)
				Vitest.assert.strictEqual(
					samples.some((sample) => sample !== 0),
					true
				)
			})
		)
	}
)
