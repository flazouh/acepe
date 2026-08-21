import { CommandId, MessageId, type SessionId } from "./ids.ts"

export const TRACER_REPLY_TOKENS = ["Hello", " from", " Acepe."] as const
export const TRACER_REPLY_TEXT = "Hello from Acepe."

export const tracerAssistantMessageId = (userMessageId: MessageId): MessageId =>
	MessageId.make(`${userMessageId}:assistant`)

export const tracerTokenCommandId = (
	sessionId: SessionId,
	assistantMessageId: MessageId,
	index: number,
): CommandId => CommandId.make(`token:${sessionId}:${assistantMessageId}:${String(index)}`)
