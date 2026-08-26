import {
	ActivityId,
	ApprovalRequestId,
	MessageId,
	ProjectId,
	SessionId,
	ToolCallId,
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import { scenarioBuilder } from "./builder.ts"
import { foldSessionSnapshot } from "./snapshot.ts"
import { isMonotonic } from "./timeline.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")

const author = () =>
	scenarioBuilder({ sessionId, projectId, startedAt: "2026-08-27T10:00:00.000Z" })

Vitest.describe("scenario builder", () => {
	Vitest.it("gives every event a distinct increasing sequence", () => {
		const built = author()
			.sessionCreated("Ship the slice")
			.userMessage(MessageId.make("message-1"), "Ship the slice")
			.turnCompleted()
			.build("seq", "")
		Vitest.assert.deepStrictEqual(
			built.steps.map((step) => step.event.sequence),
			[1, 2, 3],
		)
	})

	Vitest.it("is deterministic: the same script builds the same events twice", () => {
		const first = author().sessionCreated("Ship the slice").build("a", "")
		const second = author().sessionCreated("Ship the slice").build("a", "")
		Vitest.assert.deepStrictEqual(first.steps, second.steps)
	})

	Vitest.it("token pacing produces monotonic offsets", () => {
		const built = author()
			.sessionCreated("Ship the slice")
			.tokens(MessageId.make("m:assistant"), ["a", "b", "c"], 30)
			.build("pace", "")
		Vitest.assert.isTrue(isMonotonic(built.steps))
		Vitest.assert.strictEqual(built.steps[built.steps.length - 1]?.offsetMs, 90)
	})

	Vitest.it("tool calls and approvals decode against the canonical contract", () => {
		const built = author()
			.sessionCreated("Ship the slice")
			.toolCall({
				activityId: ActivityId.make("activity-1"),
				toolCallId: ToolCallId.make("tool-1"),
				title: "Read",
				status: "completed",
				path: "/tmp/acepe/readme.md",
				kind: "read",
			})
			.approvalRequested(ApprovalRequestId.make("approval-1"), "Permission")
			.build("tools", "")
		Vitest.assert.deepStrictEqual(
			built.steps.map((step) => step.event.type),
			["SessionCreated", "ToolCallObserved", "ApprovalRequested"],
		)
	})

	Vitest.it("the derived session snapshot comes from the canonical fold", () => {
		const built = author()
			.sessionCreated("Ship the slice")
			.userMessage(MessageId.make("message-1"), "Ship the slice")
			.build("fold", "")
		const derived = built.snapshots.find((line) => line.scopeKey === `session:${sessionId}`)
		Vitest.assert.deepStrictEqual(derived?.snapshot, foldSessionSnapshot(built.steps))
		Vitest.assert.strictEqual(derived?.snapshot.session?.title, "Ship the slice")
	})
})
