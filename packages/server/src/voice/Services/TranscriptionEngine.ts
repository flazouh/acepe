import type { PlatformError } from "effect/PlatformError"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type {
	ExternalSttCommandError,
	ExternalSttCommandMissingError,
	ExternalSttNotConfiguredError,
	ExternalSttNotLoadedError
} from "../Errors.ts"
import type { TranscriptionResult } from "../Schemas.ts"

export type TranscriptionEngineError =
	| ExternalSttNotConfiguredError
	| ExternalSttCommandMissingError
	| ExternalSttNotLoadedError
	| ExternalSttCommandError
	| PlatformError
	| Schema.SchemaError

export interface TranscriptionEngineShape {
	readonly loadModel: (path: string) => Effect.Effect<void, TranscriptionEngineError>
	readonly unloadModel: () => Effect.Effect<void>
	readonly transcribe: (
		audio: ReadonlyArray<number>,
		sampleRate: number,
		language: string | null
	) => Effect.Effect<TranscriptionResult, TranscriptionEngineError>
}

export class TranscriptionEngine extends Context.Service<
	TranscriptionEngine,
	TranscriptionEngineShape
>()("@acepe/server/voice/Services/TranscriptionEngine") {}
