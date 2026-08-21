import {
	ApprovalRequestId,
	CommandId,
	EventId,
	type JsonObject,
	type OrchestrationEvent,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	type ApprovalAnsweredFact,
	type ApprovalRequestedFact,
	evolveProjectedPendingApprovals,
	pendingApprovalMetadata,
	PROJECTION_PENDING_APPROVALS_NAME,
	type ProjectedPendingApproval,
	ProjectionPendingApprovals
} from "./ProjectionPendingApprovals.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const END = "2026-08-20T12:00:02.000Z"
const commandId = CommandId.make("cmd-1")
const answerCommandId = CommandId.make("cmd-answer-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const approvalRequestId = ApprovalRequestId.make("approval-1")
const secondApprovalRequestId = ApprovalRequestId.make("approval-2")

const requestedFact = (id: ApprovalRequestId, targetSessionId: SessionId): ApprovalRequestedFact => ({
	type: "ApprovalRequested",
	approvalRequestId: id,
	sessionId: targetSessionId
})

const answeredFact = (
	id: ApprovalRequestId,
	targetSessionId: SessionId,
	decision: ApprovalAnsweredFact["decision"]
): ApprovalAnsweredFact => ({
	type: "ApprovalAnswered",
	approvalRequestId: id,
	sessionId: targetSessionId,
	decision
})

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	"SessionCreated" | "SessionMetaUpdated" | "MessageSent"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	options: {
		readonly aggregateId?: SessionId
		readonly commandId?: CommandId
		readonly metadata?: JsonObject
	} = {}
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: options.aggregateId ?? sessionId,
	occurredAt,
	commandId: options.commandId ?? commandId,
	causationEventId: null,
	correlationId: options.commandId ?? commandId,
	metadata: options.metadata ?? {},
	type,
	payload
})

const projectCreated = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated" as const,
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

const sessionCreated = (sequence: number, targetSessionId: SessionId = sessionId) =>
	sessionEvent(
		sequence,
		"SessionCreated",
		NOW,
		{
			sessionId: targetSessionId,
			projectId,
			title: "First session"
		},
		{ aggregateId: targetSessionId }
	)

const requestEvent = (
	sequence: number,
	id: ApprovalRequestId = approvalRequestId,
	targetSessionId: SessionId = sessionId,
	occurredAt: string = LATER
) =>
	sessionEvent(
		sequence,
		"SessionMetaUpdated",
		occurredAt,
		{ sessionId: targetSessionId },
		{
			aggregateId: targetSessionId,
			metadata: pendingApprovalMetadata(requestedFact(id, targetSessionId))
		}
	)

const answerEvent = (
	sequence: number,
	id: ApprovalRequestId = approvalRequestId,
	targetSessionId: SessionId = sessionId,
	occurredAt: string = END,
	decision: ApprovalAnsweredFact["decision"] = "allow"
) =>
	sessionEvent(
		sequence,
		"SessionMetaUpdated",
		occurredAt,
		{ sessionId: targetSessionId },
		{
			aggregateId: targetSessionId,
			commandId: answerCommandId,
			metadata: pendingApprovalMetadata(answeredFact(id, targetSessionId, decision))
		}
	)

const fold = (events: ReadonlyArray<OrchestrationEvent>) =>
	Effect.reduce(events, () => Arr.empty<ProjectedPendingApproval>(), evolveProjectedPendingApprovals)

const requireApproval = (
	rows: ReadonlyArray<ProjectedPendingApproval>,
	id: ApprovalRequestId
) => {
	const found = Arr.findFirst(rows, (row) => row.approvalRequestId === id)
	return Option.match(found, {
		onNone: () => {
			Vitest.assert.fail(`expected pending approval ${id}`)
			return undefined as never
		},
		onSome: (row) => row
	})
}

Vitest.describe("ProjectionPendingApprovals", () => {
	Vitest.it("is a service class named projection.pending-approvals", () => {
		Vitest.assert.strictEqual(
			ProjectionPendingApprovals.key,
			"@acepe/server/persistence/Services/ProjectionPendingApprovals"
		)
		Vitest.assert.strictEqual(PROJECTION_PENDING_APPROVALS_NAME, "projection.pending-approvals")
	})
})

Vitest.describe("evolveProjectedPendingApprovals", () => {
	Vitest.it.effect("ignores project events", () =>
		Effect.gen(function*() {
			const rows = yield* fold([projectCreated])
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)

	Vitest.it.effect("ignores session events with no pending-approval fact", () =>
		Effect.gen(function*() {
			const rows = yield* fold([sessionCreated(2)])
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)

	Vitest.it.effect("inserts an outstanding approval from ApprovalRequested", () =>
		Effect.gen(function*() {
			const rows = yield* fold([sessionCreated(2), requestEvent(3)])
			Vitest.assert.deepStrictEqual(rows, [
				{
					approvalRequestId,
					sessionId,
					sequence: 3
				}
			])
		})
	)

	Vitest.it.effect("keeps the first sequence when the same approval is requested twice", () =>
		Effect.gen(function*() {
			const rows = yield* fold([
				sessionCreated(2),
				requestEvent(3),
				requestEvent(4, approvalRequestId, sessionId, END)
			])
			Vitest.assert.strictEqual(rows.length, 1)
			Vitest.assert.strictEqual(requireApproval(rows, approvalRequestId).sequence, 3)
		})
	)

	Vitest.it.effect("removes an outstanding approval from ApprovalAnswered", () =>
		Effect.gen(function*() {
			const rows = yield* fold([sessionCreated(2), requestEvent(3), answerEvent(4)])
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)

	Vitest.it.effect("leaves other outstanding approvals when one is answered", () =>
		Effect.gen(function*() {
			const rows = yield* fold([
				sessionCreated(2),
				requestEvent(3),
				requestEvent(4, secondApprovalRequestId),
				answerEvent(5)
			])
			Vitest.assert.deepStrictEqual(rows, [
				{
					approvalRequestId: secondApprovalRequestId,
					sessionId,
					sequence: 4
				}
			])
		})
	)

	Vitest.it.effect("ignores an answer for an approval that is not outstanding", () =>
		Effect.gen(function*() {
			const rows = yield* fold([sessionCreated(2), answerEvent(3)])
			Vitest.assert.deepStrictEqual(rows, [])
		})
	)

	Vitest.it.effect("ignores a request for another session", () =>
		Effect.gen(function*() {
			const rows = yield* fold([
				sessionCreated(2),
				requestEvent(3),
				requestEvent(4, secondApprovalRequestId, otherSessionId)
			])
			Vitest.assert.strictEqual(rows.length, 1)
			Vitest.assert.strictEqual(rows[0]?.approvalRequestId, approvalRequestId)
		})
	)

	Vitest.it.effect("replays the same events to an identical table", () =>
		Effect.gen(function*() {
			const events: ReadonlyArray<OrchestrationEvent> = [
				projectCreated,
				sessionCreated(2),
				requestEvent(3),
				requestEvent(4, secondApprovalRequestId),
				answerEvent(5)
			]
			const first = yield* fold(events)
			const second = yield* fold(events)
			Vitest.assert.deepStrictEqual(first, second)
			Vitest.assert.strictEqual(requireApproval(first, secondApprovalRequestId).sequence, 4)
			Vitest.assert.strictEqual(first.length, 1)
		})
	)
})
