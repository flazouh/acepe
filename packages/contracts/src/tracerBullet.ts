import { CommandId, MessageId, type SessionId, ActivityId, ApprovalRequestId, ToolCallId } from "./ids.ts"

export const TRACER_REPLY_TOKENS = ["Hello", " from", " Acepe."] as const
export const TRACER_REPLY_TEXT = "Hello from Acepe."
export const TRACER_TOOL_TITLE = "Read"
export const TRACER_APPROVAL_TITLE = "Permission"

export const tracerAssistantMessageId = (userMessageId: MessageId): MessageId =>
	MessageId.make(`${userMessageId}:assistant`)

export const tracerTokenCommandId = (
	sessionId: SessionId,
	assistantMessageId: MessageId,
	index: number,
): CommandId => CommandId.make(`token:${sessionId}:${assistantMessageId}:${String(index)}`)

export const tracerToolCommandId = (
	sessionId: SessionId,
	assistantMessageId: MessageId,
): CommandId => CommandId.make(`tool:${sessionId}:${assistantMessageId}`)

export const tracerApprovalCommandId = (
	sessionId: SessionId,
	assistantMessageId: MessageId,
): CommandId => CommandId.make(`approval:${sessionId}:${assistantMessageId}`)

export const tracerToolCallId = (assistantMessageId: MessageId): ToolCallId =>
	ToolCallId.make(`${assistantMessageId}:tool`)

export const tracerActivityId = (assistantMessageId: MessageId): ActivityId =>
	ActivityId.make(`${assistantMessageId}:activity`)

export const tracerApprovalRequestId = (assistantMessageId: MessageId): ApprovalRequestId =>
	ApprovalRequestId.make(`${assistantMessageId}:approval`)
