import type { PlatformError } from "effect/PlatformError"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import type {
	MicrophoneUnavailableError,
	VoiceAlreadyRecordingError,
	VoiceBackendAlreadyConfiguringError,
	VoiceModelsExternalError,
	VoiceServiceStoppedError,
	VoiceUnknownBackendError,
	VoiceUnknownModelError
} from "../Errors.ts"
import type {
	TranscriptionResult,
	VoiceEvent,
	VoiceLanguageOption,
	VoiceModelInfo
} from "../Schemas.ts"
import type { TranscriptionEngineError } from "./TranscriptionEngine.ts"

export type VoiceServiceError =
	| MicrophoneUnavailableError
	| TranscriptionEngineError
	| VoiceAlreadyRecordingError
	| VoiceBackendAlreadyConfiguringError
	| VoiceModelsExternalError
	| VoiceServiceStoppedError
	| VoiceUnknownBackendError
	| VoiceUnknownModelError
	| PlatformError
	| Schema.SchemaError

export interface VoiceServiceShape {
	readonly listModels: () => Effect.Effect<ReadonlyArray<VoiceModelInfo>, VoiceServiceError>
	readonly listLanguages: () => Effect.Effect<ReadonlyArray<VoiceLanguageOption>, VoiceServiceError>
	readonly getModelStatus: (modelId: string) => Effect.Effect<VoiceModelInfo, VoiceServiceError>
	readonly downloadModel: (modelId: string) => Effect.Effect<void, VoiceServiceError>
	readonly deleteModel: (modelId: string) => Effect.Effect<void, VoiceServiceError>
	readonly loadModel: (modelId: string) => Effect.Effect<void, VoiceServiceError>
	readonly startRecording: (sessionId: string) => Effect.Effect<void, VoiceServiceError>
	readonly stopRecording: (
		sessionId: string,
		language: string | null
	) => Effect.Effect<TranscriptionResult, VoiceServiceError>
	readonly cancelRecording: (sessionId: string) => Effect.Effect<void, VoiceServiceError>
	readonly events: Stream.Stream<VoiceEvent>
}

export class VoiceService extends Context.Service<VoiceService, VoiceServiceShape>()(
	"@acepe/server/voice/Services/VoiceService"
) {}
