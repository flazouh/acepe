import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

import { CheckpointFileCount, CheckpointNumber, CheckpointStatus, StreamToken, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { FileGitStatus } from "./fileIndex.ts"
import {
	GitBlameLine,
	GitFileDiff,
	GitHunkIndex,
} from "./git.ts"
import { AgentsId, CheckpointId, CommandId, MessageId, ProjectId, SessionId, SettingsId, SkillsId, ToolCallId, TurnId, VoiceId } from "./ids.ts"
import {
	AgentAuthenticateCommand,
	AgentCancelAuthenticationCommand,
	AgentComputerUseProbeCommand,
	AgentEventBridgeRefreshCommand,
	AgentInitializeCommand,
	AgentInstallCommand,
	AgentListCommand,
	AgentPreconnectionCapabilitiesCommand,
	AgentPreconnectionCommandsCommand,
	AgentRegisterCustomCommand,
	AgentUninstallCommand,
	ApprovalRequestCommand,
	APP_AGENTS_ID,
	ComposerMcpCatalogCommand,
	InboundRespondCommand,
	InteractionReplyCommand,
	SessionCloseCommand,
	SessionConnectionRefreshCommand,
	SessionForkCommand,
	SessionResumeCommand,
	SessionSetAutonomousCommand,
	SessionSetConfigOptionCommand,
	SessionSetModeCommand,
	SessionSetModelCommand,
	SessionStateRefreshCommand,
	ToolCallObserveCommand,
	TranscriptPageReadCommand,
	TranscriptViewportRequestCommand,
} from "./acp.ts"
import { APP_SETTINGS_ID, SettingsValue, UserSettingKey } from "./settings.ts"
import { ComposerMcpCatalog } from "./mcp.ts"
import { ConfigOptionData } from "./preconnection.ts"
import { APP_SKILLS_ID, SkillsCatalog } from "./skills.ts"
import {
	VoiceLanguageOption,
	VoiceModelInfo,
	VoiceTranscriptionResult,
	APP_VOICE_ID,
} from "./voice.ts"

export const OrchestrationAggregateKind = Schema.Literals([
	"project",
	"session",
	"settings",
	"skills",
	"voice",
	"git",
	"agent",
	"mcp",
])
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
	| {
			readonly aggregateKind: "git"
			readonly aggregateId: ProjectId
	  }
	| {
			readonly aggregateKind: "agent"
			readonly aggregateId: AgentsId
	  }
	| {
			readonly aggregateKind: "mcp"
			readonly aggregateId: ProjectId
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

export const GitStatusRefreshCommand = Schema.Struct({
	type: Schema.Literal("git.status.refresh"),
	commandId: CommandId,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString,
	status: FileGitStatus.pipe(Schema.Array, Schema.NullOr),
})
export type GitStatusRefreshCommand = typeof GitStatusRefreshCommand.Type

export const GitDiffLoadCommand = Schema.Struct({
	type: Schema.Literal("git.diff.load"),
	commandId: CommandId,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString,
	diff: GitFileDiff,
	patch: Schema.String,
})
export type GitDiffLoadCommand = typeof GitDiffLoadCommand.Type

export const GitBlameLoadCommand = Schema.Struct({
	type: Schema.Literal("git.blame.load"),
	commandId: CommandId,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString,
	blame: Schema.Array(GitBlameLine),
})
export type GitBlameLoadCommand = typeof GitBlameLoadCommand.Type

export const GitHunkAcceptCommand = Schema.Struct({
	type: Schema.Literal("git.hunk.accept"),
	commandId: CommandId,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString,
	hunkIndex: GitHunkIndex,
})
export type GitHunkAcceptCommand = typeof GitHunkAcceptCommand.Type

export const GitHunkRejectCommand = Schema.Struct({
	type: Schema.Literal("git.hunk.reject"),
	commandId: CommandId,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString,
	hunkIndex: GitHunkIndex,
	newContent: Schema.String,
})
export type GitHunkRejectCommand = typeof GitHunkRejectCommand.Type

export const McpCatalogResolveCommand = Schema.Struct({
	type: Schema.Literal("mcp.catalog.resolve"),
	commandId: CommandId,
	projectId: ProjectId,
	projectRoot: TrimmedNonEmptyString,
	catalog: ComposerMcpCatalog,
})
export type McpCatalogResolveCommand = typeof McpCatalogResolveCommand.Type

export const PreconnectionOptionsLoadCommand = Schema.Struct({
	type: Schema.Literal("preconnection.options.load"),
	commandId: CommandId,
	projectId: ProjectId,
	providerId: TrimmedNonEmptyString,
	options: Schema.Array(ConfigOptionData),
})
export type PreconnectionOptionsLoadCommand = typeof PreconnectionOptionsLoadCommand.Type

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
	GitStatusRefreshCommand,
	GitDiffLoadCommand,
	GitBlameLoadCommand,
	GitHunkAcceptCommand,
	GitHunkRejectCommand,
	SessionResumeCommand,
	SessionForkCommand,
	SessionCloseCommand,
	SessionSetModelCommand,
	SessionSetModeCommand,
	SessionSetAutonomousCommand,
	SessionSetConfigOptionCommand,
	InteractionReplyCommand,
	InboundRespondCommand,
	AgentInitializeCommand,
	AgentInstallCommand,
	AgentUninstallCommand,
	AgentAuthenticateCommand,
	AgentCancelAuthenticationCommand,
	AgentRegisterCustomCommand,
	AgentListCommand,
	SessionConnectionRefreshCommand,
	SessionStateRefreshCommand,
	TranscriptPageReadCommand,
	TranscriptViewportRequestCommand,
	AgentPreconnectionCapabilitiesCommand,
	AgentPreconnectionCommandsCommand,
	ComposerMcpCatalogCommand,
	AgentComputerUseProbeCommand,
	AgentEventBridgeRefreshCommand,
	ToolCallObserveCommand,
	ApprovalRequestCommand,
	McpCatalogResolveCommand,
	PreconnectionOptionsLoadCommand,
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

const gitRef = (projectId: ProjectId): OrchestrationAggregateRef => ({
	aggregateKind: "git",
	aggregateId: projectId,
})

const agentRef = (): OrchestrationAggregateRef => ({
	aggregateKind: "agent",
	aggregateId: APP_AGENTS_ID,
})

const mcpRef = (projectId: ProjectId): OrchestrationAggregateRef => ({
	aggregateKind: "mcp",
	aggregateId: projectId,
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
		"git.status.refresh": (command) => gitRef(command.projectId),
		"git.diff.load": (command) => gitRef(command.projectId),
		"git.blame.load": (command) => gitRef(command.projectId),
		"git.hunk.accept": (command) => gitRef(command.projectId),
		"git.hunk.reject": (command) => gitRef(command.projectId),
		"session.resume": (command) => sessionRef(command.sessionId),
		"session.fork": (command) => sessionRef(command.sessionId),
		"session.close": (command) => sessionRef(command.sessionId),
		"session.set-model": (command) => sessionRef(command.sessionId),
		"session.set-mode": (command) => sessionRef(command.sessionId),
		"session.set-autonomous": (command) => sessionRef(command.sessionId),
		"session.set-config-option": (command) => sessionRef(command.sessionId),
		"interaction.reply": (command) => sessionRef(command.sessionId),
		"inbound.respond": (command) => sessionRef(command.sessionId),
		"agent.initialize": () => agentRef(),
		"agent.install": () => agentRef(),
		"agent.uninstall": () => agentRef(),
		"agent.authenticate": () => agentRef(),
		"agent.cancel-authentication": () => agentRef(),
		"agent.register-custom": () => agentRef(),
		"agent.list": () => agentRef(),
		"session.connection.refresh": (command) => sessionRef(command.sessionId),
		"session.state.refresh": (command) => sessionRef(command.sessionId),
		"transcript.page.read": (command) => sessionRef(command.sessionId),
		"transcript.viewport.request": (command) => sessionRef(command.sessionId),
		"agent.preconnection.capabilities": () => agentRef(),
		"agent.preconnection.commands": () => agentRef(),
		"composer.mcp.catalog": () => agentRef(),
		"agent.computer-use.probe": () => agentRef(),
		"agent.event-bridge.refresh": () => agentRef(),
		"tool.call.observe": (command) => sessionRef(command.sessionId),
		"approval.request": (command) => sessionRef(command.sessionId),
		"mcp.catalog.resolve": (command) => mcpRef(command.projectId),
		"preconnection.options.load": (command) => mcpRef(command.projectId),
	}),
)
