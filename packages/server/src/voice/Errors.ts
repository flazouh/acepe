import * as Schema from "effect/Schema"

export class VoiceUnknownBackendError extends Schema.TaggedError<VoiceUnknownBackendError>()(
	"VoiceUnknownBackendError",
	{}
) {
	override get message(): string {
		return "Unknown voice backend"
	}
}

export class VoiceUnknownModelError extends Schema.TaggedError<VoiceUnknownModelError>()(
	"VoiceUnknownModelError",
	{
		modelId: Schema.String
	}
) {
	override get message(): string {
		return `Unknown model: ${this.modelId}`
	}
}

export class VoiceBackendAlreadyConfiguringError extends Schema.TaggedError<VoiceBackendAlreadyConfiguringError>()(
	"VoiceBackendAlreadyConfiguringError",
	{
		modelId: Schema.String
	}
) {
	override get message(): string {
		return `Voice backend '${this.modelId}' is already being configured`
	}
}

export class VoiceModelsExternalError extends Schema.TaggedError<VoiceModelsExternalError>()(
	"VoiceModelsExternalError",
	{
		commandEnv: Schema.String,
		modelPathEnv: Schema.String
	}
) {
	override get message(): string {
		return `Voice models are managed outside Acepe. Configure ${this.commandEnv} and optionally ${this.modelPathEnv}.`
	}
}

export class VoiceAlreadyRecordingError extends Schema.TaggedError<VoiceAlreadyRecordingError>()(
	"VoiceAlreadyRecordingError",
	{}
) {
	override get message(): string {
		return "Already recording"
	}
}

export class MicrophoneUnavailableError extends Schema.TaggedError<MicrophoneUnavailableError>()(
	"MicrophoneUnavailableError",
	{
		detail: Schema.String
	}
) {
	override get message(): string {
		return this.detail
	}
}

export class ExternalSttNotConfiguredError extends Schema.TaggedError<ExternalSttNotConfiguredError>()(
	"ExternalSttNotConfiguredError",
	{
		commandEnv: Schema.String
	}
) {
	override get message(): string {
		return `${this.commandEnv} is not configured`
	}
}

export class ExternalSttCommandMissingError extends Schema.TaggedError<ExternalSttCommandMissingError>()(
	"ExternalSttCommandMissingError",
	{
		commandEnv: Schema.String,
		path: Schema.String
	}
) {
	override get message(): string {
		return `${this.commandEnv} does not exist: ${this.path}`
	}
}

export class ExternalSttNotLoadedError extends Schema.TaggedError<ExternalSttNotLoadedError>()(
	"ExternalSttNotLoadedError",
	{}
) {
	override get message(): string {
		return "External STT backend is not loaded"
	}
}

export class ExternalSttCommandError extends Schema.TaggedError<ExternalSttCommandError>()(
	"ExternalSttCommandError",
	{
		command: Schema.String,
		exitCode: Schema.Int,
		stderr: Schema.String
	}
) {
	override get message(): string {
		if (this.stderr === "") {
			return `External STT command failed with status ${String(this.exitCode)}`
		}
		return `External STT command failed with status ${String(this.exitCode)}: ${this.stderr}`
	}
}

export class VoiceServiceStoppedError extends Schema.TaggedError<VoiceServiceStoppedError>()(
	"VoiceServiceStoppedError",
	{}
) {
	override get message(): string {
		return "Voice worker has stopped"
	}
}
