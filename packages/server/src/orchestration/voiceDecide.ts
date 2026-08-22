import {
	APP_VOICE_ID,
	type EventId,
	type IsoDateTime,
	type JsonObject,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type Sequence,
	type VoiceLanguagesListCommand,
	type VoiceLanguagesListedEvent,
	type VoiceModelDeleteCommand,
	type VoiceModelDeletedEvent,
	type VoiceModelDownloadCommand,
	type VoiceModelDownloadedEvent,
	type VoiceModelLoadCommand,
	type VoiceModelLoadedEvent,
	type VoiceModelStatusCommand,
	type VoiceModelStatusReportedEvent,
	type VoiceModelsListCommand,
	type VoiceModelsListedEvent,
	type VoiceRecordingCancelCommand,
	type VoiceRecordingCancelledEvent,
	type VoiceRecordingStartCommand,
	type VoiceRecordingStartedEvent,
	type VoiceRecordingStopCommand,
	type VoiceRecordingStoppedEvent
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import {
	requireUniqueVoiceLanguageCodes,
	requireUniqueVoiceModelIds,
	type OrchestrationReadModel
} from "./commandInvariants.ts"
import type { OrchestrationCommandInvariantError } from "./Errors.ts"

type VoiceDecideIdentity = {
	readonly eventId: EventId
	readonly occurredAt: IsoDateTime
}

export type VoiceCommand = Extract<
	OrchestrationCommand,
	{
		readonly type:
			| "voice.models.list"
			| "voice.languages.list"
			| "voice.model.status"
			| "voice.model.download"
			| "voice.model.delete"
			| "voice.model.load"
			| "voice.recording.start"
			| "voice.recording.stop"
			| "voice.recording.cancel"
	}
>

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

const voiceEvent = <Type extends string, Payload>(
	command: { readonly commandId: OrchestrationEvent["commandId"] },
	identity: VoiceDecideIdentity,
	sequence: Sequence,
	type: Type,
	payload: Payload
) => ({
	sequence,
	eventId: identity.eventId,
	aggregateKind: "voice" as const,
	aggregateId: APP_VOICE_ID,
	occurredAt: identity.occurredAt,
	commandId: command.commandId,
	causationEventId: null,
	correlationId: command.commandId,
	metadata: EMPTY_METADATA,
	type,
	payload
})

const voiceModelsListedEvent = (
	command: VoiceModelsListCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceModelsListedEvent =>
	voiceEvent(command, identity, sequence, "VoiceModelsListed", {
		models: command.models
	})

const voiceLanguagesListedEvent = (
	command: VoiceLanguagesListCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceLanguagesListedEvent =>
	voiceEvent(command, identity, sequence, "VoiceLanguagesListed", {
		languages: command.languages
	})

const voiceModelStatusReportedEvent = (
	command: VoiceModelStatusCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceModelStatusReportedEvent =>
	voiceEvent(command, identity, sequence, "VoiceModelStatusReported", {
		modelId: command.modelId,
		model: command.model
	})

const voiceModelDownloadedEvent = (
	command: VoiceModelDownloadCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceModelDownloadedEvent =>
	voiceEvent(command, identity, sequence, "VoiceModelDownloaded", {
		modelId: command.modelId
	})

const voiceModelDeletedEvent = (
	command: VoiceModelDeleteCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceModelDeletedEvent =>
	voiceEvent(command, identity, sequence, "VoiceModelDeleted", {
		modelId: command.modelId
	})

const voiceModelLoadedEvent = (
	command: VoiceModelLoadCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceModelLoadedEvent =>
	voiceEvent(command, identity, sequence, "VoiceModelLoaded", {
		modelId: command.modelId,
		model: command.model
	})

const voiceRecordingStartedEvent = (
	command: VoiceRecordingStartCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceRecordingStartedEvent =>
	voiceEvent(command, identity, sequence, "VoiceRecordingStarted", {
		sessionId: command.sessionId
	})

const voiceRecordingStoppedEvent = (
	command: VoiceRecordingStopCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceRecordingStoppedEvent =>
	voiceEvent(command, identity, sequence, "VoiceRecordingStopped", {
		sessionId: command.sessionId,
		language: command.language,
		result: command.result
	})

const voiceRecordingCancelledEvent = (
	command: VoiceRecordingCancelCommand,
	identity: VoiceDecideIdentity,
	sequence: Sequence
): VoiceRecordingCancelledEvent =>
	voiceEvent(command, identity, sequence, "VoiceRecordingCancelled", {
		sessionId: command.sessionId
	})

export const decideVoice = Effect.fn("decideVoice")(function*(
	readModel: OrchestrationReadModel,
	command: VoiceCommand,
	identity: VoiceDecideIdentity
): Effect.fn.Return<ReadonlyArray<OrchestrationEvent>, OrchestrationCommandInvariantError> {
	const sequence = nextSequence(readModel.snapshotSequence)
	switch (command.type) {
		case "voice.models.list":
			yield* requireUniqueVoiceModelIds(command)
			return [voiceModelsListedEvent(command, identity, sequence)]
		case "voice.languages.list":
			yield* requireUniqueVoiceLanguageCodes(command)
			return [voiceLanguagesListedEvent(command, identity, sequence)]
		case "voice.model.status":
			return [voiceModelStatusReportedEvent(command, identity, sequence)]
		case "voice.model.download":
			return [voiceModelDownloadedEvent(command, identity, sequence)]
		case "voice.model.delete":
			return [voiceModelDeletedEvent(command, identity, sequence)]
		case "voice.model.load":
			return [voiceModelLoadedEvent(command, identity, sequence)]
		case "voice.recording.start":
			return [voiceRecordingStartedEvent(command, identity, sequence)]
		case "voice.recording.stop":
			return [voiceRecordingStoppedEvent(command, identity, sequence)]
		case "voice.recording.cancel":
			return [voiceRecordingCancelledEvent(command, identity, sequence)]
	}
})
