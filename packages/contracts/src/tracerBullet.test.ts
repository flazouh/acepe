import { describe, expect, it } from "bun:test"

import { ActivityId, ApprovalRequestId, CommandId, MessageId, SessionId, ToolCallId } from "./ids.ts"
import {
	TRACER_APPROVAL_TITLE,
	TRACER_REPLY_TEXT,
	TRACER_REPLY_TOKENS,
	TRACER_TOOL_TITLE,
	tracerActivityId,
	tracerApprovalCommandId,
	tracerApprovalRequestId,
	tracerAssistantMessageId,
	tracerTokenCommandId,
	tracerToolCallId,
	tracerToolCommandId,
} from "./tracerBullet.ts"

describe("tracer reply", () => {
	it("joins the hard-coded tokens into the expected reply", () => {
		expect(TRACER_REPLY_TOKENS.join("")).toBe(TRACER_REPLY_TEXT)
	})

	it("derives a stable assistant message id and token command id", () => {
		const sessionId = SessionId.make("session-1")
		const userMessageId = MessageId.make("message-user")
		const assistantMessageId = tracerAssistantMessageId(userMessageId)
		expect(assistantMessageId).toBe(MessageId.make("message-user:assistant"))
		expect(tracerTokenCommandId(sessionId, assistantMessageId, 0)).toBe(
			CommandId.make("token:session-1:message-user:assistant:0"),
		)
		expect(tracerToolCommandId(sessionId, assistantMessageId)).toBe(
			CommandId.make("tool:session-1:message-user:assistant"),
		)
		expect(tracerApprovalCommandId(sessionId, assistantMessageId)).toBe(
			CommandId.make("approval:session-1:message-user:assistant"),
		)
		expect(tracerToolCallId(assistantMessageId)).toBe(ToolCallId.make("message-user:assistant:tool"))
		expect(tracerActivityId(assistantMessageId)).toBe(
			ActivityId.make("message-user:assistant:activity"),
		)
		expect(tracerApprovalRequestId(assistantMessageId)).toBe(
			ApprovalRequestId.make("message-user:assistant:approval"),
		)
		expect(TRACER_TOOL_TITLE).toBe("Read")
		expect(TRACER_APPROVAL_TITLE).toBe("Permission")
	})
})
