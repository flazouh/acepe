import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

import { CheckpointFileCount, CheckpointNumber, CheckpointStatus, StreamToken, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { CheckpointId, CommandId, MessageId, ProjectId, SessionId, SettingsId, SkillsId, ToolCallId, TurnId, VoiceId } from "./ids.ts"
import { APP_SETTINGS_ID, SettingsValue, UserSettingKey } from "./settings.ts"
import { APP_SKILLS_ID, SkillsCatalog } from "./skills.ts"
import {
	VoiceLanguageOption,
	VoiceModelInfo,
	VoiceTranscriptionResult,
	APP_VOICE_ID,
} from "./voice.ts"

export const OrchestrationAggregateKind = Schema.Literals(["project", "session", "settings", "skills", "voice"])
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type

export type OrchestrationAggregateRef =
	| {
			readonly aggregateKind: "project"
			readonly aggregateId: ProjectId
	  }
	| {
			readonly aggregateKind: "session"
			readonly aggregateId: SessionId
	  }
	| {
			readonly aggregateKind: "settings"
			readonly aggregateId: SettingsId
	  }
	| {
			readonly aggregateKind: "skills"
			readonly aggregateId: SkillsId
	  }
	| {
			readonly aggregateKind: "voice"
			readonly aggregateId: VoiceId
	  }

export const ProjectCreateCommand = Schema.Struct({
	type: Schema.Literal("project.create"),
	commandId: CommandId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
})
export type ProjectCreateCommand = typeof ProjectCreateCommand.Type

export const ProjectMetaUpdateCommand = Schema.Struct({
	type: Schema.Literal("project.meta.update"),
	commandId: CommandId,
	projectId: ProjectId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	workspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
})
export type ProjectMetaUpdateCommand = typeof ProjectMetaUpdateCommand.Type

export const ProjectDeleteCommand = Schema.Struct({
	type: Schema.Literal("project.delete"),
	commandId: CommandId,
	projectId: ProjectId,
})
export type ProjectDeleteCommand = typeof ProjectDeleteCommand.Type

export const SessionCreateCommand = Schema.Struct({
	type: Schema.Literal("session.create"),
	commandId: CommandId,
	sessionId: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
})
export type SessionCreateCommand = typeof SessionCreateCommand.Type

export const SessionPrLinkMode = Schema.Literals(["automatic", "manual"])
export type SessionPrLinkMode = typeof SessionPrLinkMode.Type

export const SessionPrNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export type SessionPrNumber = typeof SessionPrNumber.Type

export const SessionMetaUpdateCommand = Schema.Struct({
	type: Schema.Literal("session.meta.update"),
	commandId: CommandId,
	sessionId: SessionId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	prNumber: SessionPrNumber.pipe(Schema.NullOr, Schema.optionalKey),
	prLinkMode: Schema.optionalKey(SessionPrLinkMode),
})
export type SessionMetaUpdateCommand = typeof SessionMetaUpdateCommand.Type

export const SessionArchiveCommand = Schema.Struct({
	type: Schema.Literal("session.archive"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionArchiveCommand = typeof SessionArchiveCommand.Type

export const SessionUnarchiveCommand = Schema.Struct({
	type: Schema.Literal("session.unarchive"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionUnarchiveCommand = typeof SessionUnarchiveCommand.Type

export const SessionDeleteCommand = Schema.Struct({
	type: Schema.Literal("session.delete"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionDeleteCommand = typeof SessionDeleteCommand.Type

export const MessageSendCommand = Schema.Struct({
	type: Schema.Literal("message.send"),
	commandId: CommandId,
	sessionId: SessionId,
	messageId: MessageId,
	text: TrimmedNonEmptyString,
})
export type MessageSendCommand = typeof MessageSendCommand.Type

export const TokenAppendCommand = Schema.Struct({
	type: Schema.Literal("token.append"),
	commandId: CommandId,
	sessionId: SessionId,
	messageId: MessageId,
	token: StreamToken,
})
export type TokenAppendCommand = typeof TokenAppendCommand.Type

export const TurnCancelCommand = Schema.Struct({
	type: Schema.Literal("turn.cancel"),
	commandId: CommandId,
	sessionId: SessionId,
	turnId: Schema.optionalKey(TurnId),
})
export type TurnCancelCommand = typeof TurnCancelCommand.Type

export const CheckpointCreateCommand = Schema.Struct({
	type: Schema.Literal("checkpoint.create"),
	commandId: CommandId,
	sessionId: SessionId,
	checkpointId: CheckpointId,
	checkpointNumber: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	isAuto: Schema.Boolean,
	toolCallId: Schema.NullOr(ToolCallId),
	fileCount: CheckpointFileCount,
})
export type CheckpointCreateCommand = typeof CheckpointCreateCommand.Type

export const CheckpointReportReadinessCommand = Schema.Struct({
	type: Schema.Literal("checkpoint.report-readiness"),
	commandId: CommandId,
	sessionId: SessionId,
	checkpointId: CheckpointId,
	status: CheckpointStatus,
})
export type CheckpointReportReadinessCommand = typeof CheckpointReportReadinessCommand.Type

export const CheckpointRevertCommand = Schema.Struct({
	type: Schema.Literal("checkpoint.revert"),
	commandId: CommandId,
	sessionId: SessionId,
	checkpointId: CheckpointId,
})
export type CheckpointRevertCommand = typeof CheckpointRevertCommand.Type

export const SettingsSetCommand = Schema.Struct({
	type: Schema.Literal("settings.set"),
	commandId: CommandId,
	key: UserSettingKey,
	value: SettingsValue,
})
export type SettingsSetCommand = typeof SettingsSetCommand.Type

export const SkillsDiscoverCommand = Schema.Struct({
	type: Schema.Literal("skills.discover"),
	commandId: CommandId,
	catalog: SkillsCatalog,
})
export type SkillsDiscoverCommand = typeof SkillsDiscoverCommand.Type

export const VoiceModelsListCommand = Schema.Struct({
	type: Schema.Literal("voice.models.list"),
	commandId: CommandId,
	models: Schema.Array(VoiceModelInfo),
})
export type VoiceModelsListCommand = typeof VoiceModelsListCommand.Type

export const VoiceLanguagesListCommand = Schema.Struct({
	type: Schema.Literal("voice.languages.list"),
	commandId: CommandId,
	languages: Schema.Array(VoiceLanguageOption),
})
export type VoiceLanguagesListCommand = typeof VoiceLanguagesListCommand.Type

export const VoiceModelStatusCommand = Schema.Struct({
	type: Schema.Literal("voice.model.status"),
	commandId: CommandId,
	modelId: TrimmedNonEmptyString,
	model: VoiceModelInfo,
})
export type VoiceModelStatusCommand = typeof VoiceModelStatusCommand.Type

export const VoiceModelDownloadCommand = Schema.Struct({
	type: Schema.Literal("voice.model.download"),
	commandId: CommandId,
	modelId: TrimmedNonEmptyString,
})
export type VoiceModelDownloadCommand = typeof VoiceModelDownloadCommand.Type

export const VoiceModelDeleteCommand = Schema.Struct({
	type: Schema.Literal("voice.model.delete"),
	commandId: CommandId,
	modelId: TrimmedNonEmptyString,
})
export type VoiceModelDeleteCommand = typeof VoiceModelDeleteCommand.Type

export const VoiceModelLoadCommand = Schema.Struct({
	type: Schema.Literal("voice.model.load"),
	commandId: CommandId,
	modelId: TrimmedNonEmptyString,
	model: VoiceModelInfo,
})
export type VoiceModelLoadCommand = typeof VoiceModelLoadCommand.Type

export const VoiceRecordingStartCommand = Schema.Struct({
	type: Schema.Literal("voice.recording.start"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type VoiceRecordingStartCommand = typeof VoiceRecordingStartCommand.Type

export const VoiceRecordingStopCommand = Schema.Struct({
	type: Schema.Literal("voice.recording.stop"),
	commandId: CommandId,
	sessionId: SessionId,
	language: Schema.NullOr(Schema.String),
	result: VoiceTranscriptionResult,
})
export type VoiceRecordingStopCommand = typeof VoiceRecordingStopCommand.Type

export const VoiceRecordingCancelCommand = Schema.Struct({
	type: Schema.Literal("voice.recording.cancel"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type VoiceRecordingCancelCommand = typeof VoiceRecordingCancelCommand.Type

export const OrchestrationCommand = Schema.Union([
	ProjectCreateCommand,
	ProjectMetaUpdateCommand,
	ProjectDeleteCommand,
	SessionCreateCommand,
	SessionMetaUpdateCommand,
	SessionArchiveCommand,
	SessionUnarchiveCommand,
	SessionDeleteCommand,
	MessageSendCommand,
	TokenAppendCommand,
	TurnCancelCommand,
	CheckpointCreateCommand,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
	SettingsSetCommand,
	SkillsDiscoverCommand,
	VoiceModelsListCommand,
	VoiceLanguagesListCommand,
	VoiceModelStatusCommand,
	VoiceModelDownloadCommand,
	VoiceModelDeleteCommand,
	VoiceModelLoadCommand,
	VoiceRecordingStartCommand,
	VoiceRecordingStopCommand,
	VoiceRecordingCancelCommand,
])
export type OrchestrationCommand = typeof OrchestrationCommand.Type

const projectRef = (projectId: ProjectId): OrchestrationAggregateRef => ({
	aggregateKind: "project",
	aggregateId: projectId,
})

const sessionRef = (sessionId: SessionId): OrchestrationAggregateRef => ({
	aggregateKind: "session",
	aggregateId: sessionId,
})

const settingsRef = (): OrchestrationAggregateRef => ({
	aggregateKind: "settings",
	aggregateId: APP_SETTINGS_ID,
})

const skillsRef = (): OrchestrationAggregateRef => ({
	aggregateKind: "skills",
	aggregateId: APP_SKILLS_ID,
})

const voiceRef = (): OrchestrationAggregateRef => ({
	aggregateKind: "voice",
	aggregateId: APP_VOICE_ID,
})

export const commandToAggregateRef = Match.type<OrchestrationCommand>().pipe(
	Match.discriminatorsExhaustive("type")({
		"project.create": (command) => projectRef(command.projectId),
		"project.meta.update": (command) => projectRef(command.projectId),
		"project.delete": (command) => projectRef(command.projectId),
		"session.create": (command) => sessionRef(command.sessionId),
		"session.meta.update": (command) => sessionRef(command.sessionId),
		"session.archive": (command) => sessionRef(command.sessionId),
		"session.unarchive": (command) => sessionRef(command.sessionId),
		"session.delete": (command) => sessionRef(command.sessionId),
		"message.send": (command) => sessionRef(command.sessionId),
		"token.append": (command) => sessionRef(command.sessionId),
		"turn.cancel": (command) => sessionRef(command.sessionId),
		"checkpoint.create": (command) => sessionRef(command.sessionId),
		"checkpoint.report-readiness": (command) => sessionRef(command.sessionId),
		"checkpoint.revert": (command) => sessionRef(command.sessionId),
		"settings.set": () => settingsRef(),
		"skills.discover": () => skillsRef(),
		"voice.models.list": () => voiceRef(),
		"voice.languages.list": () => voiceRef(),
		"voice.model.status": () => voiceRef(),
		"voice.model.download": () => voiceRef(),
		"voice.model.delete": () => voiceRef(),
		"voice.model.load": () => voiceRef(),
		"voice.recording.start": () => voiceRef(),
		"voice.recording.stop": () => voiceRef(),
		"voice.recording.cancel": () => voiceRef(),
	}),
)
