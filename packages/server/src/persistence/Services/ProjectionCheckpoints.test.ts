import {
	CheckpointId,
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	ToolCallId,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	evolveProjectedCheckpoint,
	ProjectedCheckpoint,
	ProjectionCheckpoints
} from "./ProjectionCheckpoints.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const checkpointId = CheckpointId.make("checkpoint-1")
const checkpointTwoId = CheckpointId.make("checkpoint-2")
const toolCallId = ToolCallId.make("tool-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	| "SessionCreated"
	| "MessageSent"
	| "TurnCancelled"
	| "CheckpointCreated"
	| "CheckpointReadinessChanged"
	| "CheckpointReverted"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const projectCreated: OrchestrationEvent = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

const createdPayload = {
	sessionId,
	checkpointId,
	checkpointNumber: 1,
	name: "After edit",
	isAuto: true,
	toolCallId,
	fileCount: 2
}

const fold = (events: ReadonlyArray<OrchestrationEvent>) =>
	Effect.reduce(events, () => Option.none<typeof ProjectedCheckpoint.Type>(), evolveProjectedCheckpoint)

const requireCheckpoint = (row: Option.Option<typeof ProjectedCheckpoint.Type>) =>
	Option.match(row, {
		onNone: () => {
			Vitest.assert.fail("expected a projected checkpoint row")
			return undefined as never
		},
		onSome: (checkpoint) => checkpoint
	})

Vitest.describe("ProjectionCheckpoints", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProjectionCheckpoints.key,
			"@acepe/server/persistence/Services/ProjectionCheckpoints"
		)
	})
})

Vitest.describe("evolveProjectedCheckpoint", () => {
	Vitest.it.effect("ignores project and transcript events", () =>
		Effect.gen(function*() {
			const row = yield* fold([
				projectCreated,
				sessionEvent(2, "SessionCreated", NOW, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sessionEvent(3, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sessionEvent(4, "TurnCancelled", NOW, {
					sessionId,
					turnId
				})
			])
			Vitest.assert.deepStrictEqual(row, Option.none())
		})
	)

	Vitest.it.effect("creates a missing checkpoint from CheckpointCreated", () =>
		Effect.gen(function*() {
			const row = requireCheckpoint(
				yield* fold([sessionEvent(1, "CheckpointCreated", NOW, createdPayload)])
			)
			Vitest.assert.deepStrictEqual(row, {
				checkpointId,
				sessionId,
				sequence: 1,
				checkpointNumber: 1,
				name: "After edit",
				isAuto: true,
				toolCallId,
				fileCount: 2,
				status: "missing" as const,
				createdAt: NOW,
				lastRevertedAt: null
			})
		})
	)

	Vitest.it.effect("derives ready, missing, and error from readiness events", () =>
		Effect.gen(function*() {
			const ready = requireCheckpoint(
				yield* fold([
					sessionEvent(1, "CheckpointCreated", NOW, createdPayload),
					sessionEvent(2, "CheckpointReadinessChanged", LATER, {
						sessionId,
						checkpointId,
						status: "ready" as const
					})
				])
			)
			const missing = requireCheckpoint(
				yield* fold([
					sessionEvent(1, "CheckpointCreated", NOW, createdPayload),
					sessionEvent(2, "CheckpointReadinessChanged", LATER, {
						sessionId,
						checkpointId,
						status: "ready" as const
					}),
					sessionEvent(3, "CheckpointReadinessChanged", LATER, {
						sessionId,
						checkpointId,
						status: "missing" as const
					})
				])
			)
			const errored = requireCheckpoint(
				yield* fold([
					sessionEvent(1, "CheckpointCreated", NOW, createdPayload),
					sessionEvent(2, "CheckpointReadinessChanged", LATER, {
						sessionId,
						checkpointId,
						status: "error" as const
					})
				])
			)
			Vitest.assert.strictEqual(ready.status, "ready")
			Vitest.assert.strictEqual(missing.status, "missing")
			Vitest.assert.strictEqual(errored.status, "error")
			Vitest.assert.strictEqual(ready.sequence, 2)
			Vitest.assert.strictEqual(missing.sequence, 3)
		})
	)

	Vitest.it.effect("records revert on the checkpoint row without changing status", () =>
		Effect.gen(function*() {
			const row = requireCheckpoint(
				yield* fold([
					sessionEvent(1, "CheckpointCreated", NOW, createdPayload),
					sessionEvent(2, "CheckpointReadinessChanged", LATER, {
						sessionId,
						checkpointId,
						status: "ready" as const
					}),
					sessionEvent(3, "CheckpointReverted", LATER, {
						sessionId,
						checkpointId
					})
				])
			)
			Vitest.assert.strictEqual(row.status, "ready")
			Vitest.assert.strictEqual(row.lastRevertedAt, LATER)
			Vitest.assert.strictEqual(row.sequence, 3)
		})
	)

	Vitest.it.effect("ignores readiness and revert events when the checkpoint was never created", () =>
		Effect.gen(function*() {
			const readiness = yield* fold([
				sessionEvent(1, "CheckpointReadinessChanged", NOW, {
					sessionId,
					checkpointId,
					status: "ready" as const
				})
			])
			const reverted = yield* fold([
				sessionEvent(1, "CheckpointReverted", NOW, {
					sessionId,
					checkpointId
				})
			])
			Vitest.assert.deepStrictEqual(readiness, Option.none())
			Vitest.assert.deepStrictEqual(reverted, Option.none())
		})
	)

	Vitest.it.effect("replays the same events to an identical row", () =>
		Effect.gen(function*() {
			const events: ReadonlyArray<OrchestrationEvent> = [
				sessionEvent(1, "CheckpointCreated", NOW, {
					sessionId,
					checkpointId: checkpointTwoId,
					checkpointNumber: 2,
					name: null,
					isAuto: false,
					toolCallId: null,
					fileCount: 0
				}),
				sessionEvent(2, "CheckpointReadinessChanged", LATER, {
					sessionId,
					checkpointId: checkpointTwoId,
					status: "error" as const
				})
			]
			const first = yield* fold(events)
			const second = yield* fold(events)
			Vitest.assert.deepStrictEqual(first, second)
			Vitest.assert.strictEqual(requireCheckpoint(first).status, "error")
			Vitest.assert.strictEqual(requireCheckpoint(first).name, null)
			Vitest.assert.strictEqual(requireCheckpoint(first).isAuto, false)
		})
	)
})
