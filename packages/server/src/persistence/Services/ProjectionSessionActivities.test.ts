import {
	ActivityId,
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	ToolCallId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	activityIdFromEvent,
	activityKindFromTool,
	evolveSessionActivity,
	mergeActivityRow,
	OperationId,
	PROJECTION_SESSION_ACTIVITIES_NAME,
	type ProjectedSessionActivityRow,
	ProjectionSessionActivities,
	shouldTakeIncomingStatus,
	STUB_ACTIVITY_TITLE,
	type SessionActivityEvent
} from "./ProjectionSessionActivities.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const activityId = ActivityId.make("activity-1")
const toolCallId = ToolCallId.make("toolu_01Rm2cg5PUi3vmEEdNa3Q8cA")
const operationId = OperationId.make("op-1")

const toolObserved = (
	sequence: number,
	status: ProjectedSessionActivityRow["status"],
	linked: typeof operationId | null = null,
	output: string | null = null,
	kind: string | null = "execute"
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ToolCallObserved",
	payload: {
		sessionId,
		activityId,
		toolCallId,
		operationId: linked,
		status,
		title: "Bash",
		path: null,
		output,
		kind
	}
})

// #273: what an event appended before ToolCallObservedPayload carried an
// output looks like on a rebuild -- the key is simply absent.
const toolObservedBeforeOutputExisted = (
	sequence: number,
	status: ProjectedSessionActivityRow["status"]
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ToolCallObserved",
	payload: {
		sessionId,
		activityId,
		toolCallId,
		operationId: null,
		status,
		title: "Bash",
		path: null
	}
})

const fileObserved = (
	sequence: number,
	status: ProjectedSessionActivityRow["status"]
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "FileOperationObserved",
	payload: {
		sessionId,
		activityId,
		toolCallId,
		operationId: null,
		status,
		title: "Read",
		path: "/tmp/file.ts"
	}
})

const toolOutput = "file1\nfile2"

const statusAdvanced = (
	sequence: number,
	status: ProjectedSessionActivityRow["status"]
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ActivityStatusAdvanced",
	payload: {
		sessionId,
		activityId,
		status
	}
})

const operationLinked = (sequence: number): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ActivityOperationLinked",
	payload: {
		sessionId,
		activityId,
		operationId
	}
})

const projectCreated = (): OrchestrationEvent => ({
	sequence: 1,
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

const fold = (events: ReadonlyArray<SessionActivityEvent | OrchestrationEvent>) =>
	Effect.reduce(
		events,
		() => Option.none<ProjectedSessionActivityRow>(),
		evolveSessionActivity
	)


Vitest.describe("tool arguments across observations", () => {
	const toolRow = (
		sequence: number,
		input: Record<string, string> | null
	): ProjectedSessionActivityRow => ({
		activityId: ActivityId.make("activity-args"),
		sessionId: SessionId.make("session-args"),
		sequence,
		statusSequence: sequence,
		kind: "tool",
		toolKind: "edit",
		toolCallId: ToolCallId.make("tool-args"),
		operationId: null,
		status: "in_progress",
		title: "Write",
		path: "/tmp/a.txt",
		output: null,
		input
	})

	/**
	 * A tool_use block starts before its arguments have streamed, so Claude's
	 * first observation carries `{}` and the second carries the real input.
	 * Treating the empty start as a value let it win the merge, and the content
	 * a person needs in order to review an edit never reached the snapshot.
	 */
	Vitest.it("keeps the arguments that arrive after an empty start", () => {
		const merged = mergeActivityRow(
			Option.some(toolRow(1, {})),
			toolRow(2, { file_path: "/tmp/a.txt", content: "reviewable" })
		)
		Vitest.assert.deepStrictEqual(merged.input, {
			file_path: "/tmp/a.txt",
			content: "reviewable"
		})
	})

	Vitest.it("a later status-only observation does not erase them", () => {
		const merged = mergeActivityRow(
			Option.some(toolRow(1, { file_path: "/tmp/a.txt", content: "reviewable" })),
			toolRow(2, {})
		)
		Vitest.assert.deepStrictEqual(merged.input, {
			file_path: "/tmp/a.txt",
			content: "reviewable"
		})
	})
})

Vitest.describe("ProjectionSessionActivities", () => {
	Vitest.it("is a service class named projection.session-activities", () => {
		Vitest.assert.strictEqual(
			ProjectionSessionActivities.key,
			"@acepe/server/persistence/Services/ProjectionSessionActivities"
		)
		Vitest.assert.strictEqual(PROJECTION_SESSION_ACTIVITIES_NAME, "projection.session-activities")
	})
})

Vitest.describe("activityKindFromTool", () => {
	Vitest.it("treats a read with a path as a file operation", () => {
		Vitest.assert.strictEqual(activityKindFromTool("read", "/tmp/file.ts"), "file")
	})

	Vitest.it("treats execute as a tool even when a path is present", () => {
		Vitest.assert.strictEqual(activityKindFromTool("execute", "/tmp/file.ts"), "tool")
	})

	Vitest.it("treats a read without a path as a tool", () => {
		Vitest.assert.strictEqual(activityKindFromTool("read", null), "tool")
	})
})

Vitest.describe("shouldTakeIncomingStatus", () => {
	Vitest.it("accepts a forward transition at a later sequence", () => {
		Vitest.assert.isTrue(shouldTakeIncomingStatus("pending", "completed", 4, 5))
	})

	Vitest.it("rejects a regression at a later sequence", () => {
		Vitest.assert.isFalse(shouldTakeIncomingStatus("completed", "pending", 5, 6))
	})

	Vitest.it("rejects an earlier sequence after a later status is already applied", () => {
		Vitest.assert.isFalse(shouldTakeIncomingStatus("completed", "pending", 5, 4))
	})

	Vitest.it("does not swap completed and failed", () => {
		Vitest.assert.isFalse(shouldTakeIncomingStatus("completed", "failed", 5, 6))
		Vitest.assert.isFalse(shouldTakeIncomingStatus("failed", "completed", 5, 6))
	})
})

Vitest.describe("activityIdFromEvent", () => {
	Vitest.it("reads the activity id from activity events and ignores v1 events", () => {
		Vitest.assert.isTrue(Option.isSome(activityIdFromEvent(toolObserved(2, "pending"))))
		Vitest.assert.isTrue(Option.isNone(activityIdFromEvent(projectCreated())))
	})
})

Vitest.describe("evolveSessionActivity", () => {
	Vitest.it.effect("creates a tool row with a pending operation link", () =>
		Effect.gen(function*() {
			const row = yield* fold([toolObserved(3, "pending")])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.deepStrictEqual(row.value, {
				activityId,
				sessionId,
				sequence: 3,
				statusSequence: 3,
				kind: "tool",
				toolKind: "execute",
				toolCallId,
				operationId: null,
				status: "pending",
				title: "Bash",
				path: null,
				output: null,
				input: null
			})
		})
	)

	// #273: the output arrives on the completion event; the start event never
	// carries one, so the row has to accumulate it across the two.
	Vitest.it.effect("records the output the completion event carries", () =>
		Effect.gen(function*() {
			const row = yield* fold([
				toolObserved(3, "in_progress"),
				toolObserved(4, "completed", null, toolOutput)
			])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.strictEqual(row.value.output, toolOutput)
			Vitest.assert.strictEqual(row.value.status, "completed")
		})
	)

	Vitest.it.effect("keeps a recorded output when a later event carries none", () =>
		Effect.gen(function*() {
			const row = yield* fold([
				toolObserved(3, "completed", null, toolOutput),
				statusAdvanced(4, "completed")
			])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.strictEqual(row.value.output, toolOutput)
		})
	)

	Vitest.it.effect("projects an event stored before the output field to a null output", () =>
		Effect.gen(function*() {
			const row = yield* fold([toolObservedBeforeOutputExisted(3, "completed")])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.strictEqual(row.value.output, null)
		})
	)

	Vitest.it.effect("keeps the row renderable until the operation is linked", () =>
		Effect.gen(function*() {
			const pending = yield* fold([toolObserved(3, "in_progress")])
			Vitest.assert.isTrue(Option.isSome(pending))
			if (Option.isNone(pending)) {
				return
			}
			Vitest.assert.strictEqual(pending.value.operationId, null)
			Vitest.assert.strictEqual(pending.value.status, "in_progress")
			const linked = yield* fold([toolObserved(3, "in_progress"), operationLinked(8)])
			Vitest.assert.isTrue(Option.isSome(linked))
			if (Option.isNone(linked)) {
				return
			}
			Vitest.assert.strictEqual(linked.value.operationId, operationId)
			Vitest.assert.strictEqual(linked.value.status, "in_progress")
			Vitest.assert.strictEqual(linked.value.sequence, 3)
		})
	)

	Vitest.it.effect("orders status by event sequence and never regresses", () =>
		Effect.gen(function*() {
			const shuffled = yield* fold([
				statusAdvanced(6, "completed"),
				toolObserved(4, "pending"),
				statusAdvanced(5, "in_progress"),
				statusAdvanced(7, "pending")
			])
			Vitest.assert.isTrue(Option.isSome(shuffled))
			if (Option.isNone(shuffled)) {
				return
			}
			Vitest.assert.strictEqual(shuffled.value.status, "completed")
			Vitest.assert.strictEqual(shuffled.value.statusSequence, 6)
			Vitest.assert.strictEqual(shuffled.value.sequence, 4)
			Vitest.assert.strictEqual(shuffled.value.title, "Bash")
		})
	)

	Vitest.it.effect("does not derive order from occurredAt", () =>
		Effect.gen(function*() {
			const laterClock: SessionActivityEvent = {
				sequence: 2,
				eventId: EventId.make("event-2"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt: "2026-08-20T18:00:00.000Z",
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "ToolCallObserved",
				payload: {
					sessionId,
					activityId,
					toolCallId,
					operationId: null,
					status: "pending",
					title: "Bash",
					path: null
				}
			}
			const earlierClock: SessionActivityEvent = {
				sequence: 5,
				eventId: EventId.make("event-5"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt: "2026-08-20T11:00:00.000Z",
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "ActivityStatusAdvanced",
				payload: {
					sessionId,
					activityId,
					status: "completed"
				}
			}
			const row = yield* fold([laterClock, earlierClock])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.strictEqual(row.value.sequence, 2)
			Vitest.assert.strictEqual(row.value.status, "completed")
			Vitest.assert.strictEqual(row.value.statusSequence, 5)
		})
	)

	Vitest.it.effect("links a file operation and keeps the path", () =>
		Effect.gen(function*() {
			const row = yield* fold([fileObserved(2, "pending"), operationLinked(3)])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.strictEqual(row.value.kind, "file")
			Vitest.assert.strictEqual(row.value.path, "/tmp/file.ts")
			Vitest.assert.strictEqual(row.value.operationId, operationId)
		})
	)

	Vitest.it.effect("does not replace an existing operation link", () =>
		Effect.gen(function*() {
			const otherLink: SessionActivityEvent = {
				sequence: 9,
				eventId: EventId.make("event-9"),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "ActivityOperationLinked",
				payload: {
					sessionId,
					activityId,
					operationId: OperationId.make("op-other")
				}
			}
			const row = yield* fold([toolObserved(3, "pending", operationId), otherLink])
			Vitest.assert.isTrue(Option.isSome(row))
			if (Option.isNone(row)) {
				return
			}
			Vitest.assert.strictEqual(row.value.operationId, operationId)
		})
	)

	Vitest.it.effect("ignores v1 events that are not activity facts", () =>
		Effect.gen(function*() {
			const row = yield* fold([projectCreated()])
			Vitest.assert.isTrue(Option.isNone(row))
		})
	)
})

Vitest.describe("mergeActivityRow", () => {
	Vitest.it("fills stub title and pending operation from a later observation", () => {
		const stub: ProjectedSessionActivityRow = {
			activityId,
			sessionId,
			sequence: 6,
			statusSequence: 0,
			kind: "tool",
			toolKind: null,
			toolCallId: null,
			operationId,
			status: "pending",
			title: STUB_ACTIVITY_TITLE,
			path: null,
			output: null,
			input: null
		}
		const observed: ProjectedSessionActivityRow = {
			activityId,
			sessionId,
			sequence: 4,
			statusSequence: 4,
			kind: "tool",
			toolKind: "execute",
			toolCallId,
			operationId: null,
			status: "pending",
			title: "Bash",
			path: null,
			output: null,
			input: null
		}
		const merged = mergeActivityRow(Option.some(stub), observed)
		Vitest.assert.strictEqual(merged.sequence, 4)
		Vitest.assert.strictEqual(merged.title, "Bash")
		Vitest.assert.strictEqual(merged.toolCallId, toolCallId)
		Vitest.assert.strictEqual(merged.operationId, operationId)
		// The stub carried no tool kind; the later observation supplies it.
		Vitest.assert.strictEqual(merged.toolKind, "execute")
		// First non-null kind wins: an existing kind survives a later row that
		// carries none (e.g. a status-only update).
		const kept = mergeActivityRow(Option.some(observed), stub)
		Vitest.assert.strictEqual(kept.toolKind, "execute")
	})

	Vitest.it("takes an incoming output onto a row that has none", () => {
		const started: ProjectedSessionActivityRow = {
			activityId,
			sessionId,
			sequence: 4,
			statusSequence: 4,
			kind: "tool",
			toolKind: "execute",
			toolCallId,
			operationId: null,
			status: "in_progress",
			title: "Bash",
			path: null,
			output: null,
			input: null
		}
		const completed: ProjectedSessionActivityRow = {
			activityId,
			sessionId,
			sequence: 5,
			statusSequence: 5,
			kind: "tool",
			toolKind: null,
			toolCallId,
			operationId: null,
			status: "completed",
			title: "Bash",
			path: null,
			output: toolOutput,
			input: null
		}
		Vitest.assert.strictEqual(
			mergeActivityRow(Option.some(started), completed).output,
			toolOutput
		)
		Vitest.assert.strictEqual(
			mergeActivityRow(Option.some(completed), started).output,
			toolOutput
		)
	})
})
