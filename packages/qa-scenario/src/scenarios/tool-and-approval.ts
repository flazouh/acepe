/**
 * A turn that runs a tool and stops on a permission request.
 *
 * The approval is the last event on purpose: replaying this scenario parks the
 * app in the state where the permission bar is waiting, which is the state that
 * is hard to reach by hand against a real agent.
 */

import { ActivityId, ApprovalRequestId, MessageId, SessionId, ToolCallId } from "@acepe/contracts"
import { scenarioBuilder } from "../builder.ts"
import type { QaScenario } from "../scenario.ts"
import { QA_PROJECT_ID, QA_STARTED_AT, qaProject, qaSessionRow } from "./fixtures.ts"

const sessionId = SessionId.make("qa-tool-and-approval")
const userMessageId = MessageId.make("qa-tool-and-approval:user-1")
const assistantMessageId = MessageId.make("qa-tool-and-approval:user-1:assistant")
const activityId = ActivityId.make("qa-tool-and-approval:activity-1")
const toolCallId = ToolCallId.make("qa-tool-and-approval:tool-1")

export const toolAndApproval: QaScenario = scenarioBuilder({
	sessionId,
	projectId: QA_PROJECT_ID,
	startedAt: QA_STARTED_AT,
})
	.library([qaProject], [qaSessionRow(sessionId, "Tool and approval")])
	.sessionCreated("Tool and approval", "claude")
	.advance(120)
	.userMessage(userMessageId, "Rename the follow-mode flag everywhere")
	.advance(600)
	.tokens(assistantMessageId, ["Reading the viewport module first."], 470)
	.advance(300)
	.toolCall({
		activityId,
		toolCallId,
		title: "Read packages/desktop/src/lib/viewport/follow-mode.ts",
		status: "in_progress",
		path: "packages/desktop/src/lib/viewport/follow-mode.ts",
		kind: "read",
	})
	.advance(900)
	.toolCall({
		activityId,
		toolCallId,
		title: "Read packages/desktop/src/lib/viewport/follow-mode.ts",
		status: "completed",
		path: "packages/desktop/src/lib/viewport/follow-mode.ts",
		kind: "read",
	})
	.advance(400)
	.approvalRequested(ApprovalRequestId.make("qa-tool-and-approval:approval-1"), "Edit follow-mode.ts")
	.build("tool-and-approval", "a tool call that ends waiting on a permission")
