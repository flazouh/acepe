import type { OrchestrationCommand } from "@acepe/contracts"
import {
	VoiceLanguageOption,
	VoiceModelInfo,
	VoiceTranscriptionResult
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import type { VoiceServiceError } from "./Services/VoiceService.ts"
import { VoiceService } from "./Services/VoiceService.ts"

const decodeModels = Schema.decodeUnknownEffect(Schema.Array(VoiceModelInfo))
const decodeLanguages = Schema.decodeUnknownEffect(Schema.Array(VoiceLanguageOption))
const decodeModel = Schema.decodeUnknownEffect(VoiceModelInfo)
const decodeResult = Schema.decodeUnknownEffect(VoiceTranscriptionResult)

const asVoiceInvariant = (commandType: string) => (error: { readonly message: string }) =>
	new OrchestrationCommandInvariantError({
		commandType,
		detail: error.message
	})

const runVoice = <A>(
	commandType: string,
	program: Effect.Effect<A, VoiceServiceError | Schema.SchemaError>
) => program.pipe(Effect.mapError(asVoiceInvariant(commandType)))

const fillModelsList = Effect.fn("fillVoiceModelsList")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.models.list" }>
) {
	const voice = yield* VoiceService
	const models = yield* runVoice(command.type, voice.listModels().pipe(Effect.flatMap(decodeModels)))
	return {
		type: command.type,
		commandId: command.commandId,
		models
	} satisfies OrchestrationCommand
})

const fillLanguagesList = Effect.fn("fillVoiceLanguagesList")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.languages.list" }>
) {
	const voice = yield* VoiceService
	const languages = yield* runVoice(
		command.type,
		voice.listLanguages().pipe(Effect.flatMap(decodeLanguages))
	)
	return {
		type: command.type,
		commandId: command.commandId,
		languages
	} satisfies OrchestrationCommand
})

const fillModelStatus = Effect.fn("fillVoiceModelStatus")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.model.status" }>
) {
	const voice = yield* VoiceService
	const model = yield* runVoice(
		command.type,
		voice.getModelStatus(command.modelId).pipe(Effect.flatMap(decodeModel))
	)
	return {
		type: command.type,
		commandId: command.commandId,
		modelId: command.modelId,
		model
	} satisfies OrchestrationCommand
})

const fillModelDownload = Effect.fn("fillVoiceModelDownload")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.model.download" }>
) {
	const voice = yield* VoiceService
	yield* runVoice(command.type, voice.downloadModel(command.modelId))
	return command
})

const fillModelDelete = Effect.fn("fillVoiceModelDelete")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.model.delete" }>
) {
	const voice = yield* VoiceService
	yield* runVoice(command.type, voice.deleteModel(command.modelId))
	return command
})

const fillModelLoad = Effect.fn("fillVoiceModelLoad")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.model.load" }>
) {
	const voice = yield* VoiceService
	yield* runVoice(command.type, voice.loadModel(command.modelId))
	const model = yield* runVoice(
		command.type,
		voice.getModelStatus(command.modelId).pipe(Effect.flatMap(decodeModel))
	)
	return {
		type: command.type,
		commandId: command.commandId,
		modelId: command.modelId,
		model
	} satisfies OrchestrationCommand
})

const fillRecordingStart = Effect.fn("fillVoiceRecordingStart")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.recording.start" }>
) {
	const voice = yield* VoiceService
	yield* runVoice(command.type, voice.startRecording(command.sessionId))
	return command
})

const fillRecordingStop = Effect.fn("fillVoiceRecordingStop")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.recording.stop" }>
) {
	const voice = yield* VoiceService
	const result = yield* runVoice(
		command.type,
		voice.stopRecording(command.sessionId, command.language).pipe(Effect.flatMap(decodeResult))
	)
	return {
		type: command.type,
		commandId: command.commandId,
		sessionId: command.sessionId,
		language: command.language,
		result
	} satisfies OrchestrationCommand
})

const fillRecordingCancel = Effect.fn("fillVoiceRecordingCancel")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "voice.recording.cancel" }>
) {
	const voice = yield* VoiceService
	yield* runVoice(command.type, voice.cancelRecording(command.sessionId))
	return command
})

export const fillVoiceCommand = Effect.fn("fillVoiceCommand")(function*(
	command: OrchestrationCommand
) {
	switch (command.type) {
		case "voice.models.list":
			return yield* fillModelsList(command)
		case "voice.languages.list":
			return yield* fillLanguagesList(command)
		case "voice.model.status":
			return yield* fillModelStatus(command)
		case "voice.model.download":
			return yield* fillModelDownload(command)
		case "voice.model.delete":
			return yield* fillModelDelete(command)
		case "voice.model.load":
			return yield* fillModelLoad(command)
		case "voice.recording.start":
			return yield* fillRecordingStart(command)
		case "voice.recording.stop":
			return yield* fillRecordingStop(command)
		case "voice.recording.cancel":
			return yield* fillRecordingCancel(command)
		default:
			return command
	}
})
