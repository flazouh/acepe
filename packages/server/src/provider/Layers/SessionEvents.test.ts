import { ActivityId, CommandId, EventId, SessionId, TOOL_OUTPUT_CAP } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import {
	approvalRequestedEvent,
	FALLBACK_TOOL_TITLE,
	type OpenToolCallInfo,
	type OpenToolCalls,
	rememberOpenToolCall,
	type SessionEventHeader,
	takeOpenToolCall,
	toolCallActivityId,
	toolCallObservedEvent
} from "./SessionEvents.ts"

const sessionId = SessionId.make("session-1")

const header: SessionEventHeader = {
	sequence: 7,
	eventId: EventId.make("session-1:7"),
	occurredAt: "2026-08-26T10:00:00.000Z",
	commandId: CommandId.make("session-1:cmd:7")
}

const startInfo: OpenToolCallInfo = {
	activityId: toolCallActivityId("call_1"),
	title: "Read file",
	path: "/tmp/acepe/a.ts",
	kind: "read"
}

const emptyOpenToolCalls: Effect.Effect<OpenToolCalls> = Ref.make(
	HashMap.empty<string, OpenToolCallInfo>()
)

Vitest.describe("SessionEvents tool call identity", () => {
	Vitest.it("derives one activity id per tool call id", () => {
		Vitest.assert.strictEqual(toolCallActivityId("call_1"), ActivityId.make("call_1:activity"))
		Vitest.assert.strictEqual(toolCallActivityId("call_1"), toolCallActivityId("call_1"))
		Vitest.assert.notStrictEqual(toolCallActivityId("call_1"), toolCallActivityId("call_2"))
	})

	Vitest.it.effect("hands a later update the title and path the start recorded", () =>
		Effect.gen(function*() {
			const openToolCalls = yield* emptyOpenToolCalls
			yield* rememberOpenToolCall(openToolCalls, "call_1", "pending", startInfo)
			const info = yield* takeOpenToolCall(openToolCalls, "call_1", "in_progress")
			Vitest.assert.deepStrictEqual(info, startInfo)
		})
	)

	Vitest.it.effect("falls back to a nonempty title when no start was recorded", () =>
		Effect.gen(function*() {
			const openToolCalls = yield* emptyOpenToolCalls
			const info = yield* takeOpenToolCall(openToolCalls, "call_9", "completed")
			Vitest.assert.deepStrictEqual(info, {
				activityId: toolCallActivityId("call_9"),
				title: FALLBACK_TOOL_TITLE,
				path: null,
				kind: null
			})
		})
	)

	// openToolCalls used to grow for the whole life of a session: no provider
	// removed an entry once its call had settled, so a long session paid for
	// every tool call it had ever run.
	Vitest.it.effect("forgets a call once its status is terminal", () =>
		Effect.gen(function*() {
			const openToolCalls = yield* emptyOpenToolCalls
			yield* rememberOpenToolCall(openToolCalls, "call_1", "pending", startInfo)
			yield* rememberOpenToolCall(openToolCalls, "call_2", "in_progress", startInfo)
			const completed = yield* takeOpenToolCall(openToolCalls, "call_1", "completed")
			// The update that settles the call still sees the start info.
			Vitest.assert.strictEqual(completed.title, "Read file")
			const failed = yield* takeOpenToolCall(openToolCalls, "call_2", "failed")
			Vitest.assert.strictEqual(failed.title, "Read file")
			Vitest.assert.strictEqual(HashMap.size(yield* Ref.get(openToolCalls)), 0)
		})
	)

	// A call that arrives already settled has no later update to serve, so
	// caching one would leak an entry no one ever reads.
	Vitest.it.effect("never caches a call that starts already settled", () =>
		Effect.gen(function*() {
			const openToolCalls = yield* emptyOpenToolCalls
			yield* rememberOpenToolCall(openToolCalls, "call_1", "completed", startInfo)
			Vitest.assert.strictEqual(HashMap.size(yield* Ref.get(openToolCalls)), 0)
		})
	)
})

Vitest.describe("SessionEvents builders", () => {
	// ProjectionSessionActivities only reads a ToolCallObserved event, so the
	// payload has to carry the projector's whole row, not an encoded fact.
	Vitest.it("builds a ToolCallObserved event on the provider's own header", () => {
		const event = toolCallObservedEvent(header, sessionId, {
			activityId: startInfo.activityId,
			toolCallId: "call_1",
			status: "completed",
			title: startInfo.title,
			path: startInfo.path,
			output: "file1\nfile2",
			kind: "read"
		})
		Vitest.assert.strictEqual(event.type, "ToolCallObserved")
		Vitest.assert.strictEqual(event.aggregateKind, "session")
		Vitest.assert.strictEqual(event.aggregateId, sessionId)
		Vitest.assert.strictEqual(event.sequence, header.sequence)
		Vitest.assert.strictEqual(event.eventId, header.eventId)
		Vitest.assert.strictEqual(event.occurredAt, header.occurredAt)
		Vitest.assert.strictEqual(event.commandId, header.commandId)
		Vitest.assert.strictEqual(event.correlationId, header.commandId)
		Vitest.assert.strictEqual(event.causationEventId, null)
		Vitest.assert.strictEqual(event.payload.sessionId, sessionId)
		Vitest.assert.strictEqual(event.payload.activityId, startInfo.activityId)
		Vitest.assert.strictEqual(event.payload.toolCallId, "call_1")
		Vitest.assert.strictEqual(event.payload.operationId, null)
		Vitest.assert.strictEqual(event.payload.status, "completed")
		Vitest.assert.strictEqual(event.payload.title, "Read file")
		Vitest.assert.strictEqual(event.payload.path, "/tmp/acepe/a.ts")
		Vitest.assert.strictEqual(event.payload.output, "file1\nfile2")
		Vitest.assert.strictEqual(event.payload.kind, "read")
	})

	// #273: the payload's output is a TrimmedNonEmptyString, and
	// ToolCallObservedEvent.make THROWS on a value it rejects rather than
	// failing, which would kill the calling adapter's fiber. So every
	// provider's raw result goes through observedToolOutput here rather than
	// in each Session.ts.
	Vitest.it("normalises a provider's raw output instead of throwing on it", () => {
		const blank = toolCallObservedEvent(header, sessionId, {
			activityId: startInfo.activityId,
			toolCallId: "call_1",
			status: "completed",
			title: startInfo.title,
			path: startInfo.path,
			output: "   \n  "
		})
		Vitest.assert.strictEqual(blank.payload.output, null)
		const huge = toolCallObservedEvent(header, sessionId, {
			activityId: startInfo.activityId,
			toolCallId: "call_1",
			status: "completed",
			title: startInfo.title,
			path: startInfo.path,
			output: "x".repeat(TOOL_OUTPUT_CAP + 500)
		})
		Vitest.assert.strictEqual(huge.payload.output?.length, TOOL_OUTPUT_CAP)
	})

	// ProjectionPendingApprovals only reads a native ApprovalRequested event
	// or an explicitly stamped pendingApproval metadata key, so a permission
	// folded into SessionMetaUpdated left the desktop nothing to answer.
	Vitest.it("builds an ApprovalRequested event the pending-approvals projection reads", () => {
		const event = approvalRequestedEvent(header, sessionId, {
			approvalRequestId: "42",
			title: "Read src/lib.rs"
		})
		Vitest.assert.strictEqual(event.type, "ApprovalRequested")
		Vitest.assert.strictEqual(event.aggregateKind, "session")
		Vitest.assert.strictEqual(event.aggregateId, sessionId)
		Vitest.assert.strictEqual(event.payload.sessionId, sessionId)
		Vitest.assert.strictEqual(event.payload.approvalRequestId, "42")
		Vitest.assert.strictEqual(event.payload.title, "Read src/lib.rs")
	})
})
