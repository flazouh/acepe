/**
 * The everyday case: a user sends a message and the agent streams a reply.
 *
 * Token gaps are set to what a real Claude stream produces (roughly 470ms
 * bursts), so a replay reproduces the cadence the streaming UI has to survive
 * rather than an invented smooth one.
 */

import { MessageId, SessionId } from "@acepe/contracts"
import { scenarioBuilder } from "../builder.ts"
import type { QaScenario } from "../scenario.ts"
import { QA_PROJECT_ID, QA_STARTED_AT, qaProject, qaSessionRow } from "./fixtures.ts"

const sessionId = SessionId.make("qa-streaming-reply")
const userMessageId = MessageId.make("qa-streaming-reply:user-1")
const assistantMessageId = MessageId.make("qa-streaming-reply:user-1:assistant")

const REPLY_BURSTS = [
	"I looked at the viewport code.",
	" The follow release is gated on a generic scroll event,",
	" which the content-visibility re-measure fires on its own.",
	" That is why the panel strands above the edge.",
] as const

export const streamingReply: QaScenario = scenarioBuilder({
	sessionId,
	projectId: QA_PROJECT_ID,
	startedAt: QA_STARTED_AT,
})
	.library([qaProject], [qaSessionRow(sessionId, "Streaming reply")])
	.sessionCreated("Streaming reply", "claude")
	.advance(120)
	.userMessage(userMessageId, "Why does the panel scroll away when I send?")
	.advance(800)
	.tokens(assistantMessageId, REPLY_BURSTS, 470)
	.advance(200)
	.turnCompleted()
	.build("streaming-reply", "a user message and a bursty streamed reply")
