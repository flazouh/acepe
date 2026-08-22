import { describe, expect, it } from "bun:test"

import { CheckpointId, CommandId, EventId, MessageId, ProjectId, SessionId } from "./ids.ts"
import { APP_SETTINGS_ID } from "./settings.ts"
import {
	applyEventToRpcSessionSnapshot,
	emptyRpcSessionSnapshot,
} from "./sessionSnapshot.ts"
import { TRACER_REPLY_TEXT, TRACER_REPLY_TOKENS } from "./tracerBullet.ts"

const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const userMessageId = MessageId.make("message-user")
const assistantMessageId = MessageId.make("message-assistant")
const occurredAt = "2026-08-20T12:00:00.000Z"

const sessionCreated = {
	sequence: 2,
	eventId: EventId.make("event-2"),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SessionCreated" as const,
	payload: {
		sessionId,
		projectId,
		title: "First session",
	},
}

const messageSent = {
	sequence: 3,
	eventId: EventId.make("event-3"),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "MessageSent" as const,
	payload: {
		sessionId,
		messageId: userMessageId,
		text: "Ping",
	},
}

const tokenAt = (sequence: number, token: string) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "TokenAppended" as const,
	payload: {
		sessionId,
		messageId: assistantMessageId,
		token,
	},
})

describe("applyEventToRpcSessionSnapshot", () => {
	it("discards events at or below snapshotSequence", () => {
		const loaded = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const again = applyEventToRpcSessionSnapshot(loaded, sessionCreated)
		expect(again).toEqual(loaded)
	})

	it("appends a user row then concatenates assistant tokens in sequence", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterTokens = TRACER_REPLY_TOKENS.reduce(
			(snapshot, token, index) => applyEventToRpcSessionSnapshot(snapshot, tokenAt(4 + index, token)),
			afterUser,
		)
		expect(afterTokens.snapshotSequence).toBe(6)
		expect(afterTokens.messages.map((row) => row.rowType)).toEqual(["user", "assistant"])
		expect(afterTokens.messages.map((row) => row.sequence)).toEqual([3, 4])
		expect(afterTokens.messages[0]?.content).toEqual({ text: "Ping" })
		expect(afterTokens.messages[1]?.content).toEqual({ text: TRACER_REPLY_TEXT })
	})

	it("does not duplicate a user message already in the snapshot", () => {
		const afterUser = applyEventToRpcSessionSnapshot(
			applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated),
			messageSent,
		)
		const duplicate = applyEventToRpcSessionSnapshot(afterUser, {
			sequence: 10,
			eventId: EventId.make("event-10"),
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
				messageId: userMessageId,
				text: "Ping",
			},
		})
		expect(duplicate.messages).toHaveLength(1)
		expect(duplicate.snapshotSequence).toBe(10)
	})

	it("applies SessionMetaUpdated pull-request fields onto the snapshot session", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const linked = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionMetaUpdated",
			payload: {
				sessionId,
				prNumber: 42,
				prLinkMode: "manual",
			},
		})
		expect(linked.session?.prNumber).toBe(42)
		expect(linked.session?.prLinkMode).toBe("manual")
		expect(linked.session?.title).toBe("First session")
	})

	it("discards a SessionMetaUpdated at or below snapshotSequence", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const skipped = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 2,
			eventId: EventId.make("event-stale"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionMetaUpdated",
			payload: {
				sessionId,
				title: "Stale title",
				prNumber: 99,
				prLinkMode: "manual",
			},
		})
		expect(skipped.session?.title).toBe("First session")
		expect(skipped.session?.prNumber).toBeNull()
		expect(skipped.snapshotSequence).toBe(2)
	})

	it("ignores transcript events from another session", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const other = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: otherSessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "MessageSent",
			payload: {
				sessionId: otherSessionId,
				messageId: userMessageId,
				text: "Other",
			},
		})
		expect(other.messages).toEqual([])
		expect(other.snapshotSequence).toBe(3)
	})

	it("upserts settings by key and keeps last write", () => {
		const first = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-1"),
			aggregateKind: "settings",
			aggregateId: APP_SETTINGS_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SettingsUpdated",
			payload: {
				key: "ui_font_size",
				value: "14",
			},
		})
		const second = applyEventToRpcSessionSnapshot(first, {
			sequence: 2,
			eventId: EventId.make("event-2"),
			aggregateKind: "settings",
			aggregateId: APP_SETTINGS_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SettingsUpdated",
			payload: {
				key: "code_font_size",
				value: "13",
			},
		})
		const third = applyEventToRpcSessionSnapshot(second, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "settings",
			aggregateId: APP_SETTINGS_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SettingsUpdated",
			payload: {
				key: "ui_font_size",
				value: "18",
			},
		})
		expect(third.settings).toEqual([
			{ key: "code_font_size", value: "13", sequence: 2 },
			{ key: "ui_font_size", value: "18", sequence: 3 },
		])
		expect(third.snapshotSequence).toBe(3)
	})

	it("projects checkpoint create, readiness, and revert onto the snapshot", () => {
		const checkpointId = CheckpointId.make("checkpoint-1")
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const created = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "CheckpointCreated",
			payload: {
				sessionId,
				checkpointId,
				checkpointNumber: 1,
				name: "After edit",
				isAuto: true,
				toolCallId: null,
				fileCount: 2,
			},
		})
		expect(created.checkpoints).toEqual([
			{
				checkpointId,
				sessionId,
				sequence: 3,
				checkpointNumber: 1,
				name: "After edit",
				isAuto: true,
				toolCallId: null,
				fileCount: 2,
				status: "missing",
				createdAt: occurredAt,
				lastRevertedAt: null,
			},
		])
		const ready = applyEventToRpcSessionSnapshot(created, {
			sequence: 4,
			eventId: EventId.make("event-4"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "CheckpointReadinessChanged",
			payload: {
				sessionId,
				checkpointId,
				status: "ready",
			},
		})
		expect(ready.checkpoints[0]?.status).toBe("ready")
		expect(ready.checkpoints[0]?.sequence).toBe(4)
		const reverted = applyEventToRpcSessionSnapshot(ready, {
			sequence: 5,
			eventId: EventId.make("event-5"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "CheckpointReverted",
			payload: {
				sessionId,
				checkpointId,
			},
		})
		expect(reverted.checkpoints[0]?.status).toBe("ready")
		expect(reverted.checkpoints[0]?.lastRevertedAt).toBe(occurredAt)
		expect(reverted.snapshotSequence).toBe(5)
	})

	it("ignores checkpoint events from another session", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const other = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: otherSessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "CheckpointCreated",
			payload: {
				sessionId: otherSessionId,
				checkpointId: CheckpointId.make("checkpoint-other"),
				checkpointNumber: 1,
				name: null,
				isAuto: false,
				toolCallId: null,
				fileCount: 1,
			},
		})
		expect(other.checkpoints).toEqual([])
		expect(other.snapshotSequence).toBe(3)
	})
})
