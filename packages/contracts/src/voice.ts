import * as Schema from "effect/Schema"

import { Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { SessionId, VoiceId } from "./ids.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

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
	lastTranscription: Schema.NullOr(VoiceLastTranscription),
})
export type ProjectedVoice = typeof ProjectedVoice.Type

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
