import {
	ActivityId,
	ApprovalRequestId,
	ProjectId,
	SessionId,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	decodeProjectedPendingApprovals,
	decodeProjectedSessionActivities,
	decodeProjectedTurns,
	decodeSessionProjectionSnapshot,
	ProjectionSnapshotQuery,
	SNAPSHOT_PROJECTOR_NAMES
} from "./ProjectionSnapshotQuery.ts"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const now = "2026-08-20T12:00:00.000Z"

Vitest.describe("ProjectionSnapshotQuery", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProjectionSnapshotQuery.key,
			"@acepe/server/orchestration/Services/ProjectionSnapshotQuery"
		)
		Vitest.assert.isTrue(SNAPSHOT_PROJECTOR_NAMES.includes("projection.projects"))
	})
})

Vitest.describe("SessionProjectionSnapshot", () => {
	Vitest.it.effect("decodes a full snapshot including snapshotSequence", () =>
		Effect.gen(function*() {
			const snapshot = yield* decodeSessionProjectionSnapshot({
				snapshotSequence: 4,
				session: {
					sessionId,
					projectId,
					title: "Ship the slice",
					provider: null,
					createdAt: now,
					updatedAt: now,
					lastActivityAt: now,
					archivedAt: null,
					deletedAt: null,
					prNumber: null,
					prLinkMode: null
				},
				messages: [
					{
						sessionId,
						sequence: 2,
						messageId: "message-2",
						turnId: null,
						rowType: "user",
						content: {
							text: "Ship the slice"
						}
					}
				],
				turns: [
					{
						turnId: TurnId.make("turn-1"),
						sessionId,
						sequence: 3
					}
				],
				activities: [
					{
						activityId: ActivityId.make("activity-1"),
						sessionId,
						sequence: 4
					}
				],
				pendingApprovals: [
					{
						approvalRequestId: ApprovalRequestId.make("approval-1"),
						sessionId,
						sequence: 4
					}
				],
				checkpoints: []
			})
			Vitest.assert.strictEqual(snapshot.snapshotSequence, 4)
			Vitest.assert.strictEqual(snapshot.session?.title, "Ship the slice")
			Vitest.assert.strictEqual(snapshot.messages.length, 1)
			Vitest.assert.strictEqual(snapshot.turns[0]?.turnId, "turn-1")
			Vitest.assert.strictEqual(snapshot.activities[0]?.activityId, "activity-1")
			Vitest.assert.strictEqual(
				snapshot.pendingApprovals[0]?.approvalRequestId,
				"approval-1"
			)
		})
	)
})

Vitest.describe("optional projection row mappers", () => {
	Vitest.it.effect("map stored snake_case rows into snapshot collections", () =>
		Effect.gen(function*() {
			const turns = yield* decodeProjectedTurns([
				{
					turn_id: "turn-1",
					session_id: sessionId,
					sequence: 3
				}
			])
			const activities = yield* decodeProjectedSessionActivities([
				{
					activity_id: "activity-1",
					session_id: sessionId,
					sequence: 4
				}
			])
			const approvals = yield* decodeProjectedPendingApprovals([
				{
					approval_request_id: "approval-1",
					session_id: sessionId,
					sequence: 5
				}
			])
			Vitest.assert.deepStrictEqual(turns, [
				{
					turnId: TurnId.make("turn-1"),
					sessionId,
					sequence: 3
				}
			])
			Vitest.assert.deepStrictEqual(activities, [
				{
					activityId: ActivityId.make("activity-1"),
					sessionId,
					sequence: 4
				}
			])
			Vitest.assert.deepStrictEqual(approvals, [
				{
					approvalRequestId: ApprovalRequestId.make("approval-1"),
					sessionId,
					sequence: 5
				}
			])
		})
	)
})
