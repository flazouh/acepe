import * as Schema from "effect/Schema"

import { Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { SessionId, VoiceId } from "./ids.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** A byte count in a voice model download. Never negative. */
export const VoiceByteCount = NonNegativeInt
export type VoiceByteCount = typeof VoiceByteCount.Type

export const VoiceModelInfo = Schema.Struct({
	id: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	sizeBytes: NonNegativeInt,
	isEnglishOnly: Schema.Boolean,
	isDownloaded: Schema.Boolean,
	isLoaded: Schema.Boolean,
	downloadUrl: Schema.String,
})
export type VoiceModelInfo = typeof VoiceModelInfo.Type

export const VoiceLanguageOption = Schema.Struct({
	code: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
})
export type VoiceLanguageOption = typeof VoiceLanguageOption.Type

export const VoiceTranscriptionResult = Schema.Struct({
	text: Schema.String,
	language: Schema.NullOr(Schema.String),
	durationMs: NonNegativeInt,
})
export type VoiceTranscriptionResult = typeof VoiceTranscriptionResult.Type

export const VoiceRecordingPhase = Schema.Literal("recording")
export type VoiceRecordingPhase = typeof VoiceRecordingPhase.Type

export const VoiceRecordingState = Schema.Struct({
	sessionId: SessionId,
	phase: VoiceRecordingPhase,
})
export type VoiceRecordingState = typeof VoiceRecordingState.Type

/**
 * One reading of the live microphone level, as three successive amplitudes.
 * The meter blends the average and the peak of the three, so a single spike
 * cannot drive the bars on its own.
 */
export const VoiceAmplitudeValues = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number])
export type VoiceAmplitudeValues = typeof VoiceAmplitudeValues.Type

export const VoiceAmplitude = Schema.Struct({
	sessionId: SessionId,
	values: VoiceAmplitudeValues,
})
export type VoiceAmplitude = typeof VoiceAmplitude.Type

/** How far a model download has come. Null once the download ends, either way. */
export const VoiceModelDownload = Schema.Struct({
	modelId: TrimmedNonEmptyString,
	downloadedBytes: NonNegativeInt,
	totalBytes: NonNegativeInt,
	percent: Schema.Number,
})
export type VoiceModelDownload = typeof VoiceModelDownload.Type

export const VoiceLastTranscription = Schema.Struct({
	sessionId: SessionId,
	text: Schema.String,
	language: Schema.NullOr(Schema.String),
	durationMs: NonNegativeInt,
})
export type VoiceLastTranscription = typeof VoiceLastTranscription.Type

export const VoiceCatalog = Schema.Struct({
	models: Schema.Array(VoiceModelInfo),
	languages: Schema.Array(VoiceLanguageOption),
})
export type VoiceCatalog = typeof VoiceCatalog.Type

export const ProjectedVoice = Schema.Struct({
	sequence: Sequence,
	models: Schema.Array(VoiceModelInfo),
	languages: Schema.Array(VoiceLanguageOption),
	recording: Schema.NullOr(VoiceRecordingState),
	amplitude: Schema.NullOr(VoiceAmplitude),
	download: Schema.NullOr(VoiceModelDownload),
	lastTranscription: Schema.NullOr(VoiceLastTranscription),
})
export type ProjectedVoice = typeof ProjectedVoice.Type

/**
 * Speech to text runs outside Acepe, through a command the operator points at.
 *
 * The names live here because both sides need them: the server reads them to
 * find the backend, and the client names them when telling a person why
 * dictation produced nothing.
 */
export const EXTERNAL_STT_COMMAND_ENV_NAME = "ACEPE_VOICE_STT_COMMAND"
export const EXTERNAL_STT_MODEL_PATH_ENV_NAME = "ACEPE_VOICE_STT_MODEL_PATH"

/**
 * What to tell someone whose dictation produced nothing because no speech to
 * text backend is configured. Distinct from "no speech detected", which is what
 * the app used to say in this case and is simply untrue.
 */
export const VOICE_BACKEND_NOT_CONFIGURED_MESSAGE =
	`Speech to text is not set up. Point ${EXTERNAL_STT_COMMAND_ENV_NAME} at a transcription command (and optionally ${EXTERNAL_STT_MODEL_PATH_ENV_NAME} at its model) and restart Acepe.`

export const APP_VOICE_ID: VoiceId = VoiceId.make("app")

export const emptyVoiceModels: ReadonlyArray<VoiceModelInfo> = []

export const emptyVoiceLanguages: ReadonlyArray<VoiceLanguageOption> = []

export const emptyVoiceTranscriptionResult: VoiceTranscriptionResult = {
	text: "",
	language: null,
	durationMs: 0,
}

export const emptyVoiceCatalog: VoiceCatalog = {
	models: emptyVoiceModels,
	languages: emptyVoiceLanguages,
}

export const emptyProjectedVoice = (sequence: Sequence): ProjectedVoice => ({
	sequence,
	models: emptyVoiceModels,
	languages: emptyVoiceLanguages,
	recording: null,
	amplitude: null,
	download: null,
	lastTranscription: null,
})

export const placeholderVoiceModel = (modelId: TrimmedNonEmptyString): VoiceModelInfo => ({
	id: modelId,
	name: modelId,
	sizeBytes: 0,
	isEnglishOnly: false,
	isDownloaded: false,
	isLoaded: false,
	downloadUrl: "",
})
