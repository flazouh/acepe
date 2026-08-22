import * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import { makeQueueMicrophoneCapture } from "./MicrophoneCapture.ts"
import { StubEngineLive } from "./StubEngine.ts"
import { VoiceServiceLive } from "./VoiceService.ts"
import { MicrophoneCapture } from "../Services/MicrophoneCapture.ts"

export const VoiceRuntimeLive = Layer.unwrap(
	Effect.gen(function*() {
		const mic = yield* makeQueueMicrophoneCapture()
		return VoiceServiceLive.pipe(
			Layer.provide(Layer.succeed(MicrophoneCapture, mic.capture)),
			Layer.provide(StubEngineLive)
		)
	})
)
