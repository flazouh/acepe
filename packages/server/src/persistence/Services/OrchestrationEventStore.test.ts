import {
	CommandId,
	EventId,
	MessageId,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	decodeStoredOrchestrationEvent,
	type NewOrchestrationEvent,
	OrchestrationEventStore
} from "./OrchestrationEventStore.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")

const projectCreatedRow = {
	sequence: 1,
	event_id: "event-1",
	aggregate_kind: "project",
	aggregate_id: "project-1",
	occurred_at: occurredAt,
	command_id: "cmd-1",
	causation_event_id: null,
	correlation_id: "cmd-1",
	metadata: "{}",
	type: "ProjectCreated",
	payload: '{"projectId":"project-1","title":"Acepe","workspaceRoot":"/tmp/acepe"}'
}

const projectCreatedEvent = (): NewOrchestrationEvent => ({
	eventId: EventId.make("event-1"),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt,
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
})

Vitest.describe("OrchestrationEventStore", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			OrchestrationEventStore.key,
			"@acepe/server/persistence/Services/OrchestrationEventStore"
		)
	})
})

Vitest.describe("decodeStoredOrchestrationEvent", () => {
	Vitest.it.effect("decodes a stored ProjectCreated row", () =>
		Effect.gen(function*() {
			const event = yield* decodeStoredOrchestrationEvent(projectCreatedRow)
			Vitest.assert.strictEqual(event.sequence, 1)
			Vitest.assert.strictEqual(event.type, "ProjectCreated")
			Vitest.assert.deepStrictEqual(event.payload, projectCreatedEvent().payload)
		})
	)

	Vitest.it.effect("surfaces invalid JSON as SchemaError", () =>
		Effect.gen(function*() {
			const error = yield* decodeStoredOrchestrationEvent({
				sequence: 1,
				event_id: "event-1",
				aggregate_kind: "project",
				aggregate_id: "project-1",
				occurred_at: occurredAt,
				command_id: "cmd-1",
				causation_event_id: null,
				correlation_id: "cmd-1",
				metadata: "{}",
				type: "ProjectCreated",
				payload: "not-json"
			}).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SchemaError")
			Vitest.assert.isTrue(Schema.isSchemaError(error))
		})
	)

	Vitest.it.effect("surfaces an invalid payload as SchemaError", () =>
		Effect.gen(function*() {
			const error = yield* decodeStoredOrchestrationEvent({
				sequence: 1,
				event_id: "event-1",
				aggregate_kind: "project",
				aggregate_id: "project-1",
				occurred_at: occurredAt,
				command_id: "cmd-1",
				causation_event_id: null,
				correlation_id: "cmd-1",
				metadata: "{}",
				type: "ProjectCreated",
				payload: '{"oops":true}'
			}).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "SchemaError")
			Vitest.assert.isTrue(Schema.isSchemaError(error))
		})
	)
})

const messageSent: NewOrchestrationEvent = {
	eventId: EventId.make("event-2"),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "MessageSent",
	payload: {
		sessionId,
		messageId,
		text: "hello"
	}
}

Vitest.describe("NewOrchestrationEvent", () => {
	Vitest.it("accepts a session message without sequence", () => {
		Vitest.assert.strictEqual(messageSent.type, "MessageSent")
	})
})
