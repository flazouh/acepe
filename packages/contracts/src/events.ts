import * as Schema from "effect/Schema"

import { CheckpointFileCount, CheckpointNumber, CheckpointStatus, IsoDateTime, JsonObject, Sequence, StreamToken, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { FileGitStatus } from "./fileIndex.ts"
import { GitBlameLine, GitFileDiff, GitHunkIndex } from "./git.ts"
import {
	AgentsId,
	CheckpointId,
	CommandId,
	EventId,
	MessageId,
	ProjectId,
	SessionId,
	SettingsId,
	SkillsId,
	ToolCallId,
	TurnId,
	VoiceId,
} from "./ids.ts"
import {
	AgentAuthenticatedPayload,
	AgentAuthenticationCancelledPayload,
	AgentCustomRegisteredPayload,
	AgentInitializedPayload,
	AgentInstalledPayload,
	AgentUninstalledPayload,
	AgentsListedPayload,
	ApprovalRequestedPayload,
	ComposerMcpCatalogLoadedPayload,
	ComputerUseProbedPayload,
	EventBridgeRefreshedPayload,
	InboundRespondedPayload,
	InteractionRepliedPayload,
	PreconnectionCapabilitiesListedPayload,
	PreconnectionCommandsListedPayload,
	SessionAutonomousSetPayload,
	SessionClosedPayload,
	SessionConfigOptionSetPayload,
	SessionConnectionRefreshedPayload,
	SessionForkedPayload,
	SessionModelSetPayload,
	SessionModeSetPayload,
	SessionResumedPayload,
	SessionStateRefreshedPayload,
	ToolCallObservedPayload,
	TranscriptPageReadPayload,
	TranscriptViewportRequestedPayload,
} from "./acp.ts"
import { SettingsValue, UserSettingKey } from "./settings.ts"
import { ComposerMcpCatalog } from "./mcp.ts"
import { ConfigOptionData } from "./preconnection.ts"
import { SkillsCatalog } from "./skills.ts"
import {
	VoiceLanguageOption,
	VoiceModelInfo,
	VoiceTranscriptionResult,
} from "./voice.ts"
import {
	type OrchestrationAggregateKind,
	SessionPrLinkMode,
	SessionPrNumber,
} from "./orchestration.ts"

export const CorrelationId = CommandId
export type CorrelationId = typeof CorrelationId.Type

export const OrchestrationEventType = Schema.Literals([
	"ProjectCreated",
	"ProjectMetaUpdated",
	"ProjectDeleted",
	"SessionCreated",
	"SessionMetaUpdated",
	"SessionArchived",
	"SessionUnarchived",
	"SessionDeleted",
	"MessageSent",
	"TokenAppended",
	"TurnCancelled",
	"CheckpointCreated",
	"CheckpointReadinessChanged",
	"CheckpointReverted",
	"SettingsUpdated",
	"SkillsDiscovered",
	"VoiceModelsListed",
	"VoiceLanguagesListed",
	"VoiceModelStatusReported",
	"VoiceModelDownloaded",
	"VoiceModelDeleted",
	"VoiceModelLoaded",
	"VoiceRecordingStarted",
	"VoiceRecordingStopped",
	"VoiceRecordingCancelled",
	"GitStatusRefreshed",
	"GitDiffLoaded",
	"GitBlameLoaded",
	"GitHunkAccepted",
	"GitHunkRejected",
	"SessionResumed",
	"SessionForked",
	"SessionClosed",
	"SessionModelSet",
	"SessionModeSet",
	"SessionAutonomousSet",
	"SessionConfigOptionSet",
	"InteractionReplied",
	"InboundResponded",
	"AgentInitialized",
	"AgentInstalled",
	"AgentUninstalled",
	"AgentAuthenticated",
	"AgentAuthenticationCancelled",
	"AgentCustomRegistered",
	"AgentsListed",
	"SessionConnectionRefreshed",
	"SessionStateRefreshed",
	"TranscriptPageRead",
	"TranscriptViewportRequested",
	"PreconnectionCapabilitiesListed",
	"PreconnectionCommandsListed",
	"ComposerMcpCatalogLoaded",
	"ComputerUseProbed",
	"EventBridgeRefreshed",
	"ToolCallObserved",
	"ApprovalRequested",
	"McpCatalogResolved",
	"PreconnectionOptionsLoaded",
])
export type OrchestrationEventType = typeof OrchestrationEventType.Type

export const ProjectCreatedPayload = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
})
export type ProjectCreatedPayload = typeof ProjectCreatedPayload.Type

export const ProjectMetaUpdatedPayload = Schema.Struct({
	projectId: ProjectId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	workspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
})
export type ProjectMetaUpdatedPayload = typeof ProjectMetaUpdatedPayload.Type

export const ProjectDeletedPayload = Schema.Struct({
	projectId: ProjectId,
})
export type ProjectDeletedPayload = typeof ProjectDeletedPayload.Type

export const SessionCreatedPayload = Schema.Struct({
	sessionId: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
})
export type SessionCreatedPayload = typeof SessionCreatedPayload.Type

export const SessionMetaUpdatedPayload = Schema.Struct({
	sessionId: SessionId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	prNumber: SessionPrNumber.pipe(Schema.NullOr, Schema.optionalKey),
	prLinkMode: Schema.optionalKey(SessionPrLinkMode),
})
export type SessionMetaUpdatedPayload = typeof SessionMetaUpdatedPayload.Type

export const SessionArchivedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionArchivedPayload = typeof SessionArchivedPayload.Type

export const SessionUnarchivedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionUnarchivedPayload = typeof SessionUnarchivedPayload.Type

export const SessionDeletedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionDeletedPayload = typeof SessionDeletedPayload.Type

export const MessageSentPayload = Schema.Struct({
	sessionId: SessionId,
	messageId: MessageId,
	text: TrimmedNonEmptyString,
})
export type MessageSentPayload = typeof MessageSentPayload.Type

export const TokenAppendedPayload = Schema.Struct({
	sessionId: SessionId,
	messageId: MessageId,
	token: StreamToken,
})
export type TokenAppendedPayload = typeof TokenAppendedPayload.Type

export const TurnCancelledPayload = Schema.Struct({
	sessionId: SessionId,
	turnId: Schema.optionalKey(TurnId),
})
export type TurnCancelledPayload = typeof TurnCancelledPayload.Type

export const CheckpointCreatedPayload = Schema.Struct({
	sessionId: SessionId,
	checkpointId: CheckpointId,
	checkpointNumber: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	isAuto: Schema.Boolean,
	toolCallId: Schema.NullOr(ToolCallId),
	fileCount: CheckpointFileCount,
})
export type CheckpointCreatedPayload = typeof CheckpointCreatedPayload.Type

export const CheckpointReadinessChangedPayload = Schema.Struct({
	sessionId: SessionId,
	checkpointId: CheckpointId,
	status: CheckpointStatus,
})
export type CheckpointReadinessChangedPayload = typeof CheckpointReadinessChangedPayload.Type

export const CheckpointRevertedPayload = Schema.Struct({
	sessionId: SessionId,
	checkpointId: CheckpointId,
})
export type CheckpointRevertedPayload = typeof CheckpointRevertedPayload.Type

export const SettingsUpdatedPayload = Schema.Struct({
	key: UserSettingKey,
	value: SettingsValue,
})
export type SettingsUpdatedPayload = typeof SettingsUpdatedPayload.Type

export const SkillsDiscoveredPayload = SkillsCatalog
export type SkillsDiscoveredPayload = typeof SkillsDiscoveredPayload.Type

export const VoiceModelsListedPayload = Schema.Struct({
	models: Schema.Array(VoiceModelInfo),
})
export type VoiceModelsListedPayload = typeof VoiceModelsListedPayload.Type

export const VoiceLanguagesListedPayload = Schema.Struct({
	languages: Schema.Array(VoiceLanguageOption),
})
export type VoiceLanguagesListedPayload = typeof VoiceLanguagesListedPayload.Type

export const VoiceModelStatusReportedPayload = Schema.Struct({
	modelId: TrimmedNonEmptyString,
	model: VoiceModelInfo,
})
export type VoiceModelStatusReportedPayload = typeof VoiceModelStatusReportedPayload.Type

export const VoiceModelDownloadedPayload = Schema.Struct({
	modelId: TrimmedNonEmptyString,
})
export type VoiceModelDownloadedPayload = typeof VoiceModelDownloadedPayload.Type

export const VoiceModelDeletedPayload = Schema.Struct({
	modelId: TrimmedNonEmptyString,
})
export type VoiceModelDeletedPayload = typeof VoiceModelDeletedPayload.Type

export const VoiceModelLoadedPayload = Schema.Struct({
	modelId: TrimmedNonEmptyString,
	model: VoiceModelInfo,
})
export type VoiceModelLoadedPayload = typeof VoiceModelLoadedPayload.Type

export const VoiceRecordingStartedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type VoiceRecordingStartedPayload = typeof VoiceRecordingStartedPayload.Type

export const VoiceRecordingStoppedPayload = Schema.Struct({
	sessionId: SessionId,
	language: Schema.NullOr(Schema.String),
	result: VoiceTranscriptionResult,
})
export type VoiceRecordingStoppedPayload = typeof VoiceRecordingStoppedPayload.Type

export const VoiceRecordingCancelledPayload = Schema.Struct({
	sessionId: SessionId,
})
export type VoiceRecordingCancelledPayload = typeof VoiceRecordingCancelledPayload.Type

export const GitStatusRefreshedPayload = Schema.Struct({
	projectId: ProjectId,
	status: FileGitStatus.pipe(Schema.Array, Schema.NullOr),
})
export type GitStatusRefreshedPayload = typeof GitStatusRefreshedPayload.Type

export const GitDiffLoadedPayload = Schema.Struct({
	projectId: ProjectId,
	filePath: TrimmedNonEmptyString,
	diff: GitFileDiff,
	patch: Schema.String,
})
export type GitDiffLoadedPayload = typeof GitDiffLoadedPayload.Type

export const GitBlameLoadedPayload = Schema.Struct({
	projectId: ProjectId,
	filePath: TrimmedNonEmptyString,
	blame: Schema.Array(GitBlameLine),
})
export type GitBlameLoadedPayload = typeof GitBlameLoadedPayload.Type

export const GitHunkAcceptedPayload = Schema.Struct({
	projectId: ProjectId,
	filePath: TrimmedNonEmptyString,
	hunkIndex: GitHunkIndex,
})
export type GitHunkAcceptedPayload = typeof GitHunkAcceptedPayload.Type

export const GitHunkRejectedPayload = Schema.Struct({
	projectId: ProjectId,
	filePath: TrimmedNonEmptyString,
	hunkIndex: GitHunkIndex,
	newContent: Schema.String,
})
export type GitHunkRejectedPayload = typeof GitHunkRejectedPayload.Type

export const McpCatalogResolvedPayload = Schema.Struct({
	projectId: ProjectId,
	catalog: ComposerMcpCatalog,
})
export type McpCatalogResolvedPayload = typeof McpCatalogResolvedPayload.Type

export const PreconnectionOptionsLoadedPayload = Schema.Struct({
	projectId: ProjectId,
	providerId: TrimmedNonEmptyString,
	options: Schema.Array(ConfigOptionData),
})
export type PreconnectionOptionsLoadedPayload = typeof PreconnectionOptionsLoadedPayload.Type

const defineOrchestrationEvent = <
	const EventType extends OrchestrationEventType,
	Payload extends Schema.Top,
	const Kind extends OrchestrationAggregateKind,
	AggregateId extends Schema.Top,
>(fields: {
	readonly type: EventType
	readonly payload: Payload
	readonly aggregateKind: Kind
	readonly aggregateId: AggregateId
}) =>
	Schema.Struct({
		sequence: Sequence,
		eventId: EventId,
		aggregateKind: Schema.Literal(fields.aggregateKind),
		aggregateId: fields.aggregateId,
		occurredAt: IsoDateTime,
		commandId: CommandId,
		causationEventId: Schema.NullOr(EventId),
		correlationId: CorrelationId,
		metadata: JsonObject,
		type: Schema.Literal(fields.type),
		payload: fields.payload,
	})

export const ProjectCreatedEvent = defineOrchestrationEvent({
	type: "ProjectCreated",
	payload: ProjectCreatedPayload,
	aggregateKind: "project",
	aggregateId: ProjectId,
})
export type ProjectCreatedEvent = typeof ProjectCreatedEvent.Type

export const ProjectMetaUpdatedEvent = defineOrchestrationEvent({
	type: "ProjectMetaUpdated",
	payload: ProjectMetaUpdatedPayload,
	aggregateKind: "project",
	aggregateId: ProjectId,
})
export type ProjectMetaUpdatedEvent = typeof ProjectMetaUpdatedEvent.Type

export const ProjectDeletedEvent = defineOrchestrationEvent({
	type: "ProjectDeleted",
	payload: ProjectDeletedPayload,
	aggregateKind: "project",
	aggregateId: ProjectId,
})
export type ProjectDeletedEvent = typeof ProjectDeletedEvent.Type

export const SessionCreatedEvent = defineOrchestrationEvent({
	type: "SessionCreated",
	payload: SessionCreatedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionCreatedEvent = typeof SessionCreatedEvent.Type

export const SessionMetaUpdatedEvent = defineOrchestrationEvent({
	type: "SessionMetaUpdated",
	payload: SessionMetaUpdatedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionMetaUpdatedEvent = typeof SessionMetaUpdatedEvent.Type

export const SessionArchivedEvent = defineOrchestrationEvent({
	type: "SessionArchived",
	payload: SessionArchivedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionArchivedEvent = typeof SessionArchivedEvent.Type

export const SessionUnarchivedEvent = defineOrchestrationEvent({
	type: "SessionUnarchived",
	payload: SessionUnarchivedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionUnarchivedEvent = typeof SessionUnarchivedEvent.Type

export const SessionDeletedEvent = defineOrchestrationEvent({
	type: "SessionDeleted",
	payload: SessionDeletedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionDeletedEvent = typeof SessionDeletedEvent.Type

export const MessageSentEvent = defineOrchestrationEvent({
	type: "MessageSent",
	payload: MessageSentPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type MessageSentEvent = typeof MessageSentEvent.Type

export const TokenAppendedEvent = defineOrchestrationEvent({
	type: "TokenAppended",
	payload: TokenAppendedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type TokenAppendedEvent = typeof TokenAppendedEvent.Type

export const TurnCancelledEvent = defineOrchestrationEvent({
	type: "TurnCancelled",
	payload: TurnCancelledPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type TurnCancelledEvent = typeof TurnCancelledEvent.Type

export const CheckpointCreatedEvent = defineOrchestrationEvent({
	type: "CheckpointCreated",
	payload: CheckpointCreatedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type CheckpointCreatedEvent = typeof CheckpointCreatedEvent.Type

export const CheckpointReadinessChangedEvent = defineOrchestrationEvent({
	type: "CheckpointReadinessChanged",
	payload: CheckpointReadinessChangedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type CheckpointReadinessChangedEvent = typeof CheckpointReadinessChangedEvent.Type

export const CheckpointRevertedEvent = defineOrchestrationEvent({
	type: "CheckpointReverted",
	payload: CheckpointRevertedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type CheckpointRevertedEvent = typeof CheckpointRevertedEvent.Type

export const SettingsUpdatedEvent = defineOrchestrationEvent({
	type: "SettingsUpdated",
	payload: SettingsUpdatedPayload,
	aggregateKind: "settings",
	aggregateId: SettingsId,
})
export type SettingsUpdatedEvent = typeof SettingsUpdatedEvent.Type

export const SkillsDiscoveredEvent = defineOrchestrationEvent({
	type: "SkillsDiscovered",
	payload: SkillsDiscoveredPayload,
	aggregateKind: "skills",
	aggregateId: SkillsId,
})
export type SkillsDiscoveredEvent = typeof SkillsDiscoveredEvent.Type

export const VoiceModelsListedEvent = defineOrchestrationEvent({
	type: "VoiceModelsListed",
	payload: VoiceModelsListedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceModelsListedEvent = typeof VoiceModelsListedEvent.Type

export const VoiceLanguagesListedEvent = defineOrchestrationEvent({
	type: "VoiceLanguagesListed",
	payload: VoiceLanguagesListedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceLanguagesListedEvent = typeof VoiceLanguagesListedEvent.Type

export const VoiceModelStatusReportedEvent = defineOrchestrationEvent({
	type: "VoiceModelStatusReported",
	payload: VoiceModelStatusReportedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceModelStatusReportedEvent = typeof VoiceModelStatusReportedEvent.Type

export const VoiceModelDownloadedEvent = defineOrchestrationEvent({
	type: "VoiceModelDownloaded",
	payload: VoiceModelDownloadedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceModelDownloadedEvent = typeof VoiceModelDownloadedEvent.Type

export const VoiceModelDeletedEvent = defineOrchestrationEvent({
	type: "VoiceModelDeleted",
	payload: VoiceModelDeletedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceModelDeletedEvent = typeof VoiceModelDeletedEvent.Type

export const VoiceModelLoadedEvent = defineOrchestrationEvent({
	type: "VoiceModelLoaded",
	payload: VoiceModelLoadedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceModelLoadedEvent = typeof VoiceModelLoadedEvent.Type

export const VoiceRecordingStartedEvent = defineOrchestrationEvent({
	type: "VoiceRecordingStarted",
	payload: VoiceRecordingStartedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceRecordingStartedEvent = typeof VoiceRecordingStartedEvent.Type

export const VoiceRecordingStoppedEvent = defineOrchestrationEvent({
	type: "VoiceRecordingStopped",
	payload: VoiceRecordingStoppedPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceRecordingStoppedEvent = typeof VoiceRecordingStoppedEvent.Type

export const VoiceRecordingCancelledEvent = defineOrchestrationEvent({
	type: "VoiceRecordingCancelled",
	payload: VoiceRecordingCancelledPayload,
	aggregateKind: "voice",
	aggregateId: VoiceId,
})
export type VoiceRecordingCancelledEvent = typeof VoiceRecordingCancelledEvent.Type

export const GitStatusRefreshedEvent = defineOrchestrationEvent({
	type: "GitStatusRefreshed",
	payload: GitStatusRefreshedPayload,
	aggregateKind: "git",
	aggregateId: ProjectId,
})
export type GitStatusRefreshedEvent = typeof GitStatusRefreshedEvent.Type

export const GitDiffLoadedEvent = defineOrchestrationEvent({
	type: "GitDiffLoaded",
	payload: GitDiffLoadedPayload,
	aggregateKind: "git",
	aggregateId: ProjectId,
})
export type GitDiffLoadedEvent = typeof GitDiffLoadedEvent.Type

export const GitBlameLoadedEvent = defineOrchestrationEvent({
	type: "GitBlameLoaded",
	payload: GitBlameLoadedPayload,
	aggregateKind: "git",
	aggregateId: ProjectId,
})
export type GitBlameLoadedEvent = typeof GitBlameLoadedEvent.Type

export const GitHunkAcceptedEvent = defineOrchestrationEvent({
	type: "GitHunkAccepted",
	payload: GitHunkAcceptedPayload,
	aggregateKind: "git",
	aggregateId: ProjectId,
})
export type GitHunkAcceptedEvent = typeof GitHunkAcceptedEvent.Type

export const GitHunkRejectedEvent = defineOrchestrationEvent({
	type: "GitHunkRejected",
	payload: GitHunkRejectedPayload,
	aggregateKind: "git",
	aggregateId: ProjectId,
})
export type GitHunkRejectedEvent = typeof GitHunkRejectedEvent.Type

export const SessionResumedEvent = defineOrchestrationEvent({
	type: "SessionResumed",
	payload: SessionResumedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionResumedEvent = typeof SessionResumedEvent.Type

export const SessionForkedEvent = defineOrchestrationEvent({
	type: "SessionForked",
	payload: SessionForkedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionForkedEvent = typeof SessionForkedEvent.Type

export const SessionClosedEvent = defineOrchestrationEvent({
	type: "SessionClosed",
	payload: SessionClosedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionClosedEvent = typeof SessionClosedEvent.Type

export const SessionModelSetEvent = defineOrchestrationEvent({
	type: "SessionModelSet",
	payload: SessionModelSetPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionModelSetEvent = typeof SessionModelSetEvent.Type

export const SessionModeSetEvent = defineOrchestrationEvent({
	type: "SessionModeSet",
	payload: SessionModeSetPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionModeSetEvent = typeof SessionModeSetEvent.Type

export const SessionAutonomousSetEvent = defineOrchestrationEvent({
	type: "SessionAutonomousSet",
	payload: SessionAutonomousSetPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionAutonomousSetEvent = typeof SessionAutonomousSetEvent.Type

export const SessionConfigOptionSetEvent = defineOrchestrationEvent({
	type: "SessionConfigOptionSet",
	payload: SessionConfigOptionSetPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionConfigOptionSetEvent = typeof SessionConfigOptionSetEvent.Type

export const InteractionRepliedEvent = defineOrchestrationEvent({
	type: "InteractionReplied",
	payload: InteractionRepliedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type InteractionRepliedEvent = typeof InteractionRepliedEvent.Type

export const InboundRespondedEvent = defineOrchestrationEvent({
	type: "InboundResponded",
	payload: InboundRespondedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type InboundRespondedEvent = typeof InboundRespondedEvent.Type

export const AgentInitializedEvent = defineOrchestrationEvent({
	type: "AgentInitialized",
	payload: AgentInitializedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentInitializedEvent = typeof AgentInitializedEvent.Type

export const AgentInstalledEvent = defineOrchestrationEvent({
	type: "AgentInstalled",
	payload: AgentInstalledPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentInstalledEvent = typeof AgentInstalledEvent.Type

export const AgentUninstalledEvent = defineOrchestrationEvent({
	type: "AgentUninstalled",
	payload: AgentUninstalledPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentUninstalledEvent = typeof AgentUninstalledEvent.Type

export const AgentAuthenticatedEvent = defineOrchestrationEvent({
	type: "AgentAuthenticated",
	payload: AgentAuthenticatedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentAuthenticatedEvent = typeof AgentAuthenticatedEvent.Type

export const AgentAuthenticationCancelledEvent = defineOrchestrationEvent({
	type: "AgentAuthenticationCancelled",
	payload: AgentAuthenticationCancelledPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentAuthenticationCancelledEvent = typeof AgentAuthenticationCancelledEvent.Type

export const AgentCustomRegisteredEvent = defineOrchestrationEvent({
	type: "AgentCustomRegistered",
	payload: AgentCustomRegisteredPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentCustomRegisteredEvent = typeof AgentCustomRegisteredEvent.Type

export const AgentsListedEvent = defineOrchestrationEvent({
	type: "AgentsListed",
	payload: AgentsListedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type AgentsListedEvent = typeof AgentsListedEvent.Type

export const SessionConnectionRefreshedEvent = defineOrchestrationEvent({
	type: "SessionConnectionRefreshed",
	payload: SessionConnectionRefreshedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionConnectionRefreshedEvent = typeof SessionConnectionRefreshedEvent.Type

export const SessionStateRefreshedEvent = defineOrchestrationEvent({
	type: "SessionStateRefreshed",
	payload: SessionStateRefreshedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionStateRefreshedEvent = typeof SessionStateRefreshedEvent.Type

export const TranscriptPageReadEvent = defineOrchestrationEvent({
	type: "TranscriptPageRead",
	payload: TranscriptPageReadPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type TranscriptPageReadEvent = typeof TranscriptPageReadEvent.Type

export const TranscriptViewportRequestedEvent = defineOrchestrationEvent({
	type: "TranscriptViewportRequested",
	payload: TranscriptViewportRequestedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type TranscriptViewportRequestedEvent = typeof TranscriptViewportRequestedEvent.Type

export const PreconnectionCapabilitiesListedEvent = defineOrchestrationEvent({
	type: "PreconnectionCapabilitiesListed",
	payload: PreconnectionCapabilitiesListedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type PreconnectionCapabilitiesListedEvent = typeof PreconnectionCapabilitiesListedEvent.Type

export const PreconnectionCommandsListedEvent = defineOrchestrationEvent({
	type: "PreconnectionCommandsListed",
	payload: PreconnectionCommandsListedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type PreconnectionCommandsListedEvent = typeof PreconnectionCommandsListedEvent.Type

export const ComposerMcpCatalogLoadedEvent = defineOrchestrationEvent({
	type: "ComposerMcpCatalogLoaded",
	payload: ComposerMcpCatalogLoadedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type ComposerMcpCatalogLoadedEvent = typeof ComposerMcpCatalogLoadedEvent.Type

export const ComputerUseProbedEvent = defineOrchestrationEvent({
	type: "ComputerUseProbed",
	payload: ComputerUseProbedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type ComputerUseProbedEvent = typeof ComputerUseProbedEvent.Type

export const EventBridgeRefreshedEvent = defineOrchestrationEvent({
	type: "EventBridgeRefreshed",
	payload: EventBridgeRefreshedPayload,
	aggregateKind: "agent",
	aggregateId: AgentsId,
})
export type EventBridgeRefreshedEvent = typeof EventBridgeRefreshedEvent.Type

export const ToolCallObservedEvent = defineOrchestrationEvent({
	type: "ToolCallObserved",
	payload: ToolCallObservedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type ToolCallObservedEvent = typeof ToolCallObservedEvent.Type

export const ApprovalRequestedEvent = defineOrchestrationEvent({
	type: "ApprovalRequested",
	payload: ApprovalRequestedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type ApprovalRequestedEvent = typeof ApprovalRequestedEvent.Type
export const McpCatalogResolvedEvent = defineOrchestrationEvent({
	type: "McpCatalogResolved",
	payload: McpCatalogResolvedPayload,
	aggregateKind: "mcp",
	aggregateId: ProjectId,
})
export type McpCatalogResolvedEvent = typeof McpCatalogResolvedEvent.Type

export const PreconnectionOptionsLoadedEvent = defineOrchestrationEvent({
	type: "PreconnectionOptionsLoaded",
	payload: PreconnectionOptionsLoadedPayload,
	aggregateKind: "mcp",
	aggregateId: ProjectId,
})
export type PreconnectionOptionsLoadedEvent = typeof PreconnectionOptionsLoadedEvent.Type

export const OrchestrationEvent = Schema.Union([
	ProjectCreatedEvent,
	ProjectMetaUpdatedEvent,
	ProjectDeletedEvent,
	SessionCreatedEvent,
	SessionMetaUpdatedEvent,
	SessionArchivedEvent,
	SessionUnarchivedEvent,
	SessionDeletedEvent,
	MessageSentEvent,
	TokenAppendedEvent,
	TurnCancelledEvent,
	CheckpointCreatedEvent,
	CheckpointReadinessChangedEvent,
	CheckpointRevertedEvent,
	SettingsUpdatedEvent,
	SkillsDiscoveredEvent,
	VoiceModelsListedEvent,
	VoiceLanguagesListedEvent,
	VoiceModelStatusReportedEvent,
	VoiceModelDownloadedEvent,
	VoiceModelDeletedEvent,
	VoiceModelLoadedEvent,
	VoiceRecordingStartedEvent,
	VoiceRecordingStoppedEvent,
	VoiceRecordingCancelledEvent,
	GitStatusRefreshedEvent,
	GitDiffLoadedEvent,
	GitBlameLoadedEvent,
	GitHunkAcceptedEvent,
	GitHunkRejectedEvent,
	SessionResumedEvent,
	SessionForkedEvent,
	SessionClosedEvent,
	SessionModelSetEvent,
	SessionModeSetEvent,
	SessionAutonomousSetEvent,
	SessionConfigOptionSetEvent,
	InteractionRepliedEvent,
	InboundRespondedEvent,
	AgentInitializedEvent,
	AgentInstalledEvent,
	AgentUninstalledEvent,
	AgentAuthenticatedEvent,
	AgentAuthenticationCancelledEvent,
	AgentCustomRegisteredEvent,
	AgentsListedEvent,
	SessionConnectionRefreshedEvent,
	SessionStateRefreshedEvent,
	TranscriptPageReadEvent,
	TranscriptViewportRequestedEvent,
	PreconnectionCapabilitiesListedEvent,
	PreconnectionCommandsListedEvent,
	ComposerMcpCatalogLoadedEvent,
	ComputerUseProbedEvent,
	EventBridgeRefreshedEvent,
	ToolCallObservedEvent,
	ApprovalRequestedEvent,
	McpCatalogResolvedEvent,
	PreconnectionOptionsLoadedEvent,
])
export type OrchestrationEvent = typeof OrchestrationEvent.Type
