/**
 * A thinking-heavy turn: the model streams a visible thinking phase first,
 * then the reply, inside one assistant message. This is the canonical
 * ThoughtAppended path (thought_delta facts carved out of SessionMetaUpdated),
 * and the replay proves the client renders the thinking block from the same
 * assistant entry the reply lands in -- mixed thought/text segments, exactly
 * the restored-session materializer contract.
 *
 * Burst gaps mirror streaming-reply's real Claude cadence.
 */

import { MessageId, SessionId } from "@acepe/contracts"
import { scenarioBuilder } from "../builder.ts"
import type { QaScenario } from "../scenario.ts"
import {
	QA_PROJECT_ID,
	QA_STARTED_AT,
	QA_WORKSPACE_ROOT,
	qaProject,
	qaSessionRow,
} from "./fixtures.ts"

const sessionId = SessionId.make("qa-thinking-reply")
const userMessageId = MessageId.make("qa-thinking-reply:user-1")
const assistantMessageId = MessageId.make("qa-thinking-reply:user-1:assistant")

const THINKING_BURSTS = [
	"Counting primes between 800 and 900.",
	" Candidates end in 1, 3, 7 or 9; strike multiples of 3, 7, 11, 13, 17, 19, 23 and 29.",
	" That leaves 809, 811, 821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883 and 887.",
] as const

const REPLY_BURSTS = ["There are 15 primes", " strictly between 800 and 900."] as const

export const thinkingReply: QaScenario = scenarioBuilder({
	sessionId,
	projectId: QA_PROJECT_ID,
	startedAt: QA_STARTED_AT,
})
	.shellBoot({ workspaceRoot: QA_WORKSPACE_ROOT, branch: "main" })
	.library([qaProject], [qaSessionRow(sessionId, "Thinking reply")])
	.sessionCreated("Thinking reply", "claude")
	.advance(120)
	.userMessage(userMessageId, "How many primes lie strictly between 800 and 900?")
	.advance(800)
	.thoughts(assistantMessageId, THINKING_BURSTS, 470)
	.advance(300)
	.tokens(assistantMessageId, REPLY_BURSTS, 470)
	.advance(200)
	.turnCompleted()
	.build("thinking-reply", "a streamed thinking phase, then the reply, in one assistant entry")
