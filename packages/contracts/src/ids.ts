import * as Schema from "effect/Schema"

const entityId = <const Brand extends string>(brand: Brand) =>
	Schema.Trim.check(Schema.isNonEmpty()).pipe(Schema.brand(brand))

export const ProjectId = entityId("ProjectId")
export type ProjectId = typeof ProjectId.Type
export const decodeProjectId = Schema.decodeUnknownEffect(ProjectId)

export const SessionId = entityId("SessionId")
export type SessionId = typeof SessionId.Type
export const decodeSessionId = Schema.decodeUnknownEffect(SessionId)

export const TurnId = entityId("TurnId")
export type TurnId = typeof TurnId.Type
export const decodeTurnId = Schema.decodeUnknownEffect(TurnId)

export const MessageId = entityId("MessageId")
export type MessageId = typeof MessageId.Type
export const decodeMessageId = Schema.decodeUnknownEffect(MessageId)

export const ActivityId = entityId("ActivityId")
export type ActivityId = typeof ActivityId.Type
export const decodeActivityId = Schema.decodeUnknownEffect(ActivityId)

export const ToolCallId = entityId("ToolCallId")
export type ToolCallId = typeof ToolCallId.Type
export const decodeToolCallId = Schema.decodeUnknownEffect(ToolCallId)

export const CheckpointId = entityId("CheckpointId")
export type CheckpointId = typeof CheckpointId.Type
export const decodeCheckpointId = Schema.decodeUnknownEffect(CheckpointId)

export const SettingsId = entityId("SettingsId")
export type SettingsId = typeof SettingsId.Type
export const decodeSettingsId = Schema.decodeUnknownEffect(SettingsId)

export const ApprovalRequestId = entityId("ApprovalRequestId")
export type ApprovalRequestId = typeof ApprovalRequestId.Type
export const decodeApprovalRequestId = Schema.decodeUnknownEffect(ApprovalRequestId)

export const EventId = entityId("EventId")
export type EventId = typeof EventId.Type
export const decodeEventId = Schema.decodeUnknownEffect(EventId)

export const CommandId = entityId("CommandId")
export type CommandId = typeof CommandId.Type
export const decodeCommandId = Schema.decodeUnknownEffect(CommandId)

/** Provider provenance. This is not Acepe session identity. */
export const ProviderSessionId = entityId("ProviderSessionId")
export type ProviderSessionId = typeof ProviderSessionId.Type
export const decodeProviderSessionId = Schema.decodeUnknownEffect(ProviderSessionId)
