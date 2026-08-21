import { describe, expect, it } from "bun:test"

import { CommandId, MessageId, SessionId } from "./ids.ts"
import {
	TRACER_REPLY_TEXT,
	TRACER_REPLY_TOKENS,
	tracerAssistantMessageId,
	tracerTokenCommandId,
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
	})
})
