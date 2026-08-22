import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type { MicrophoneUnavailableError } from "../Errors.ts"

export const DEFAULT_CAPTURE_SAMPLE_RATE = 48_000

export const NO_MICROPHONE_MESSAGE =
	"No audio input device available. On macOS, check System Settings \u2192 Privacy & Security \u2192 Microphone."

export type CaptureSession = {
	readonly sampleRate: number
	readonly pull: () => Effect.Effect<ReadonlyArray<number>>
	readonly takeError: () => Effect.Effect<Option.Option<string>>
	readonly stop: () => Effect.Effect<void>
}

export interface MicrophoneCaptureShape {
	readonly start: () => Effect.Effect<CaptureSession, MicrophoneUnavailableError>
}

export class MicrophoneCapture extends Context.Service<MicrophoneCapture, MicrophoneCaptureShape>()(
	"@acepe/server/voice/Services/MicrophoneCapture"
) {}
