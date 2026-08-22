import * as Schema from "effect/Schema"

export const EXTERNAL_BACKEND_ID = "external"
export const EXTERNAL_BACKEND_NAME = "Speech to text"
export const EXTERNAL_BACKEND_SENTINEL_PATH = "__acepe_external_stt_backend__"
export const EXTERNAL_STT_COMMAND_ENV = "ACEPE_VOICE_STT_COMMAND"
export const EXTERNAL_STT_MODEL_PATH_ENV = "ACEPE_VOICE_STT_MODEL_PATH"
export const EXTERNAL_STT_LANGUAGE_ENV = "ACEPE_VOICE_LANGUAGE"
export const EXTERNAL_STT_AUDIO_PATH_ENV = "ACEPE_VOICE_AUDIO_PATH"

export const WHISPER_SAMPLE_RATE = 16_000
export const WORKER_TICK_MS = 50
export const WARN_SECS = 8 * 60
export const MAX_SECS = 10 * 60
export const TRANSCRIPTION_TARGET_PEAK = 0.85
export const LIVE_METER_TARGET_PEAK = 0.35
export const MAX_NORMALIZATION_GAIN = 64
export const MAX_LIVE_METER_GAIN = 24

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type NonNegativeInt = typeof NonNegativeInt.Type

export const AmplitudeValues = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number])
export type AmplitudeValues = typeof AmplitudeValues.Type

export const VoiceModelInfo = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	sizeBytes: NonNegativeInt,
	isEnglishOnly: Schema.Boolean,
	isDownloaded: Schema.Boolean,
	isLoaded: Schema.Boolean,
	downloadUrl: Schema.String
})
export type VoiceModelInfo = typeof VoiceModelInfo.Type

export const VoiceLanguageOption = Schema.Struct({
	code: Schema.String,
	name: Schema.String
})
export type VoiceLanguageOption = typeof VoiceLanguageOption.Type

export const TranscriptionResult = Schema.Struct({
	text: Schema.String,
	language: Schema.NullOr(Schema.String),
	durationMs: NonNegativeInt
})
export type TranscriptionResult = typeof TranscriptionResult.Type

export const emptyTranscriptionResult: TranscriptionResult = {
	text: "",
	language: null,
	durationMs: 0
}

export class VoiceAmplitudeEvent extends Schema.TaggedClass<VoiceAmplitudeEvent>()("VoiceAmplitude", {
	sessionId: Schema.String,
	values: AmplitudeValues
}) {}

export class VoiceRecordingErrorEvent extends Schema.TaggedClass<VoiceRecordingErrorEvent>()(
	"VoiceRecordingError",
	{
		sessionId: Schema.String,
		message: Schema.String
	}
) {}

export class VoiceTranscriptionCompleteEvent extends Schema.TaggedClass<VoiceTranscriptionCompleteEvent>()(
	"VoiceTranscriptionComplete",
	{
		sessionId: Schema.String,
		text: Schema.String,
		language: Schema.NullOr(Schema.String),
		durationMs: NonNegativeInt
	}
) {}

export class VoiceTranscriptionErrorEvent extends Schema.TaggedClass<VoiceTranscriptionErrorEvent>()(
	"VoiceTranscriptionError",
	{
		sessionId: Schema.String,
		message: Schema.String
	}
) {}

export class VoiceModelDownloadProgressEvent extends Schema.TaggedClass<VoiceModelDownloadProgressEvent>()(
	"VoiceModelDownloadProgress",
	{
		modelId: Schema.String,
		downloadedBytes: NonNegativeInt,
		totalBytes: NonNegativeInt,
		percent: Schema.Number
	}
) {}

export class VoiceModelDownloadCompleteEvent extends Schema.TaggedClass<VoiceModelDownloadCompleteEvent>()(
	"VoiceModelDownloadComplete",
	{
		modelId: Schema.String
	}
) {}

export class VoiceModelDownloadErrorEvent extends Schema.TaggedClass<VoiceModelDownloadErrorEvent>()(
	"VoiceModelDownloadError",
	{
		modelId: Schema.String,
		message: Schema.String
	}
) {}

export const VoiceEvent = Schema.Union([
	VoiceAmplitudeEvent,
	VoiceRecordingErrorEvent,
	VoiceTranscriptionCompleteEvent,
	VoiceTranscriptionErrorEvent,
	VoiceModelDownloadProgressEvent,
	VoiceModelDownloadCompleteEvent,
	VoiceModelDownloadErrorEvent
])
export type VoiceEvent = typeof VoiceEvent.Type
