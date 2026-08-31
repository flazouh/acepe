import { describe, expect, it } from "bun:test"

import {
	ActivityId,
	CheckpointId,
	CommandId,
	EventId,
	MessageId,
	ProjectId,
	SessionId,
	TerminalId,
	ToolCallId,
	TurnId,
} from "./ids.ts"
import { APP_SETTINGS_ID } from "./settings.ts"
import {
	applyEventToRpcSessionSnapshot,
	emptyRpcSessionSnapshot,
} from "./sessionSnapshot.ts"
import { TRACER_REPLY_TEXT, TRACER_REPLY_TOKENS } from "./tracerBullet.ts"
import { emptyComposerMcpCatalog } from "./mcp.ts"
import { APP_SKILLS_ID, emptySkillsCatalog } from "./skills.ts"
import { APP_VOICE_ID, placeholderVoiceModel } from "./voice.ts"
import { TERMINAL_OUTPUT_CAP } from "./terminal.ts"

const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const terminalId = TerminalId.make("term-1")
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

const thoughtAt = (sequence: number, token: string) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ThoughtAppended" as const,
	payload: {
		sessionId,
		messageId: assistantMessageId,
		token,
	},
})

const userTurnId = TurnId.make(userMessageId)

const turnCompleted = (sequence: number, occurredAtOverride = occurredAt) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt: occurredAtOverride,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "TurnCompleted" as const,
	payload: {
		sessionId,
		turnId: userTurnId,
	},
})

const turnCancelled = (sequence: number) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "TurnCancelled" as const,
	payload: {
		sessionId,
		turnId: userTurnId,
	},
})

const turnUsageObserved = (
	sequence: number,
	payload: Partial<{
		readonly inputTokens: number
		readonly outputTokens: number
		readonly totalTokens: number
		readonly costUsd: number
		readonly contextWindowSize: number
	}> = {},
	forSessionId = sessionId,
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
	type: "TurnUsageObserved" as const,
	payload: {
		sessionId: forSessionId,
		turnId: userTurnId,
		...payload,
	},
})

const toolCallObserved = (
	sequence: number,
	status: "in_progress" | "completed" | "failed",
	output: string | null,
) => ({
	sequence,
	eventId: EventId.make(`event-tool-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ToolCallObserved" as const,
	payload: {
		sessionId,
		activityId: ActivityId.make("activity-tool-1"),
		toolCallId: ToolCallId.make("call_1"),
		operationId: null,
		status,
		title: "Read file",
		path: "/tmp/acepe/a.ts",
		output,
	},
})

describe("applyEventToRpcSessionSnapshot", () => {
	it("opens a running turn on MessageSent", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		expect(afterUser.turns).toEqual([
			{
				turnId: userTurnId,
				sessionId,
				sequence: 3,
				status: "running",
				startedAt: occurredAt,
				endedAt: null,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costUsd: 0,
				contextWindowSize: null,
			},
		])
	})

	it("closes the running turn as completed on TurnCompleted", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterCompleted = applyEventToRpcSessionSnapshot(afterUser, turnCompleted(4))
		expect(afterCompleted.turns[0]?.status).toBe("completed")
		expect(afterCompleted.turns[0]?.endedAt).toBe(occurredAt)
	})

	it("closes the running turn as cancelled on TurnCancelled", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterCancelled = applyEventToRpcSessionSnapshot(afterUser, turnCancelled(4))
		expect(afterCancelled.turns[0]?.status).toBe("cancelled")
	})

	it("overwrites the running turn's usage fields from TurnUsageObserved", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterUsage = applyEventToRpcSessionSnapshot(
			afterUser,
			turnUsageObserved(4, {
				inputTokens: 120,
				outputTokens: 48,
				costUsd: 0.0123,
				contextWindowSize: 200_000,
			}),
		)
		expect(afterUsage.turns[0]?.inputTokens).toBe(120)
		expect(afterUsage.turns[0]?.outputTokens).toBe(48)
		expect(afterUsage.turns[0]?.costUsd).toBe(0.0123)
		expect(afterUsage.turns[0]?.contextWindowSize).toBe(200_000)
		expect(afterUsage.turns[0]?.status).toBe("running")
	})

	it("keeps a prior usage reading when a later TurnUsageObserved omits a field", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterFirstUsage = applyEventToRpcSessionSnapshot(
			afterUser,
			turnUsageObserved(4, { inputTokens: 10, outputTokens: 5 }),
		)
		const afterSecondUsage = applyEventToRpcSessionSnapshot(
			afterFirstUsage,
			turnUsageObserved(5, { outputTokens: 9 }),
		)
		expect(afterSecondUsage.turns[0]?.inputTokens).toBe(10)
		expect(afterSecondUsage.turns[0]?.outputTokens).toBe(9)
	})

	it("ignores TurnUsageObserved for another session", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterUsage = applyEventToRpcSessionSnapshot(
			afterUser,
			turnUsageObserved(4, { outputTokens: 999 }, otherSessionId),
		)
		expect(afterUsage.turns[0]?.outputTokens).toBe(0)
	})

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
		expect(afterTokens.messages[1]?.content).toEqual({
			parts: [{ kind: "text", text: TRACER_REPLY_TEXT }],
		})
	})

	// The canonical assistant shape is an ordered parts sequence: thought and
	// text deltas interleave inside one assistant message, and a reopened
	// session must replay them in streamed order -- all-thinking-first would
	// misrepresent an interleaved turn.
	it("folds thought deltas into ordered parts around the reply", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterStream = [
			thoughtAt(4, "Weighing "),
			thoughtAt(5, "the options."),
			tokenAt(6, "Here is "),
			tokenAt(7, "the answer."),
			thoughtAt(8, "Wait, checking once more."),
		].reduce(applyEventToRpcSessionSnapshot, afterUser)
		expect(afterStream.messages.map((row) => row.rowType)).toEqual(["user", "assistant"])
		expect(afterStream.messages[1]?.content).toEqual({
			parts: [
				{ kind: "thought", text: "Weighing the options." },
				{ kind: "text", text: "Here is the answer." },
				{ kind: "thought", text: "Wait, checking once more." },
			],
		})
	})

	it("starts an assistant row from a thought delta alone", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterThought = applyEventToRpcSessionSnapshot(afterUser, thoughtAt(4, "Considering."))
		expect(afterThought.messages[1]?.content).toEqual({
			parts: [{ kind: "thought", text: "Considering." }],
		})
	})

	// Real provider deltas often end in a space. The client-side fold used to
	// re-decode the running text through a trimming schema, so the space died
	// and the next token joined the previous word ("I'll runall three steps.").
	it("keeps the whitespace a token carries when it joins the running text", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const afterUser = applyEventToRpcSessionSnapshot(afterSession, messageSent)
		const afterTokens = ["I'll run ", "all three", "\n\n", "steps."].reduce(
			(snapshot, token, index) => applyEventToRpcSessionSnapshot(snapshot, tokenAt(4 + index, token)),
			afterUser,
		)
		expect(afterTokens.messages[1]?.content).toEqual({
			parts: [{ kind: "text", text: "I'll run all three\n\nsteps." }],
		})
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

	it("captures providerSessionId from a provider_session SessionMetaUpdated fact", () => {
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
			metadata: { type: "provider_session", providerSessionId: "claude-uuid-42" },
			type: "SessionMetaUpdated",
			payload: {
				sessionId,
			},
		})
		expect(linked.session?.providerSessionId).toBe("claude-uuid-42")
	})

	it("marks providerSessionFailed on the snapshot session when ProviderSessionFailed fires", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const failed = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "ProviderSessionFailed",
			payload: {
				sessionId,
				providerId: "claude",
				operation: "startSession",
				detail: "adapter died before session_id arrived",
			},
		})
		expect(failed.session?.providerSessionFailed).toBe(true)
	})

	it("folds three SessionModeSet events onto the last mode", () => {
		const created = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		expect(created.session?.currentModeId).toBe(null)
		const modeSet = (snapshot: typeof created, sequence: number, modeId: string) =>
			applyEventToRpcSessionSnapshot(snapshot, {
				sequence,
				eventId: EventId.make(`event-${sequence}`),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "SessionModeSet",
				payload: {
					sessionId,
					modeId,
				},
			})
		const planned = modeSet(created, 3, "plan")
		expect(planned.session?.currentModeId).toBe("plan")
		const reviewed = modeSet(modeSet(planned, 4, "build"), 5, "review")
		expect(reviewed.session?.currentModeId).toBe("review")
	})

	it("folds three SessionModelSet events onto the last model", () => {
		const created = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		expect(created.session?.currentModelId).toBe(null)
		const modelSet = (snapshot: typeof created, sequence: number, modelId: string) =>
			applyEventToRpcSessionSnapshot(snapshot, {
				sequence,
				eventId: EventId.make(`event-${sequence}`),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "SessionModelSet",
				payload: {
					sessionId,
					modelId,
				},
			})
		const opus = modelSet(created, 3, "claude-opus-5")
		expect(opus.session?.currentModelId).toBe("claude-opus-5")
		const haiku = modelSet(modelSet(opus, 4, "claude-sonnet-5"), 5, "claude-haiku-4-5")
		expect(haiku.session?.currentModelId).toBe("claude-haiku-4-5")
	})

	it("folds SessionConfigOptionSet onto the last value per key", () => {
		const created = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		expect(created.session?.configOptions).toBe(null)
		const optionSet = (snapshot: typeof created, sequence: number, key: string, value: string) =>
			applyEventToRpcSessionSnapshot(snapshot, {
				sequence,
				eventId: EventId.make(`event-${sequence}`),
				aggregateKind: "session",
				aggregateId: sessionId,
				occurredAt,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "SessionConfigOptionSet",
				payload: {
					sessionId,
					key,
					value,
				},
			})
		const low = optionSet(created, 3, "reasoning_effort", "low")
		expect(low.session?.configOptions).toEqual({ reasoning_effort: "low" })
		const high = optionSet(optionSet(low, 4, "reasoning_effort", "max"), 5, "reasoning_effort", "high")
		expect(high.session?.configOptions).toEqual({ reasoning_effort: "high" })
	})

	it("keeps chosen config option values through a later SessionMetaUpdated touch", () => {
		const created = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const chosen = applyEventToRpcSessionSnapshot(created, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionConfigOptionSet",
			payload: {
				sessionId,
				key: "reasoning_effort",
				value: "high",
			},
		})
		const touched = applyEventToRpcSessionSnapshot(chosen, {
			sequence: 4,
			eventId: EventId.make("event-4"),
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
			},
		})
		expect(touched.session?.configOptions).toEqual({ reasoning_effort: "high" })
	})

	it("captures a provider's model catalog from a session_models SessionMetaUpdated fact", () => {
		const created = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		expect(created.session?.availableModels).toBe(null)
		const listed = applyEventToRpcSessionSnapshot(created, {
			sequence: 3,
			eventId: EventId.make("event-3"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {
				contractKind: "session_models",
				models: [{ modelId: "claude-opus-5", name: "Opus 5", description: null }],
			},
			type: "SessionMetaUpdated",
			payload: {
				sessionId,
			},
		})
		expect(listed.session?.availableModels).toEqual([
			{ modelId: "claude-opus-5", name: "Opus 5", description: null },
		])
		// A later meta update carries no catalog, and must not empty the picker.
		const renamed = applyEventToRpcSessionSnapshot(listed, {
			sequence: 4,
			eventId: EventId.make("event-4"),
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
				title: "Renamed session",
			},
		})
		expect(renamed.session?.availableModels).toEqual([
			{ modelId: "claude-opus-5", name: "Opus 5", description: null },
		])
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
				files: [],
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

	it("replaces the skills catalog on SkillsDiscovered", () => {
		const first = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-1"),
			aggregateKind: "skills",
			aggregateId: APP_SKILLS_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SkillsDiscovered",
			payload: emptySkillsCatalog,
		})
		expect(first.skillsCatalog).toEqual({
			sequence: 1,
			agents: [],
			agentSkills: [],
			plugins: [],
			pluginSkills: [],
			tree: [],
		})
		expect(first.snapshotSequence).toBe(1)
	})

	it("projects VoiceModelsListed onto the snapshot voice field", () => {
		const first = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-voice-1"),
			aggregateKind: "voice",
			aggregateId: APP_VOICE_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "VoiceModelsListed",
			payload: {
				models: [placeholderVoiceModel("external")],
			},
		})
		expect(first.voice).toEqual({
			sequence: 1,
			models: [placeholderVoiceModel("external")],
			languages: [],
			recording: null,
			amplitude: null,
			download: null,
			lastTranscription: null,
		})
		expect(first.snapshotSequence).toBe(1)
	})

	it("projects VoiceAmplitudeObserved onto the snapshot then clears it on VoiceRecordingStopped", () => {
		const afterAmplitude = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-voice-1"),
			aggregateKind: "voice",
			aggregateId: APP_VOICE_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "VoiceAmplitudeObserved",
			payload: {
				sessionId,
				values: [0.1, 0.2, 0.3],
			},
		})
		expect(afterAmplitude.voice?.amplitude).toEqual({
			sessionId,
			values: [0.1, 0.2, 0.3],
		})
		const afterStopped = applyEventToRpcSessionSnapshot(afterAmplitude, {
			sequence: 2,
			eventId: EventId.make("event-voice-2"),
			aggregateKind: "voice",
			aggregateId: APP_VOICE_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "VoiceRecordingStopped",
			payload: {
				sessionId,
				language: null,
				result: { text: "", language: null, durationMs: 0 },
			},
		})
		expect(afterStopped.voice?.amplitude).toBeNull()
	})

	it("projects VoiceModelDownloadProgressed onto the snapshot then clears it on VoiceModelDownloaded", () => {
		const afterProgress = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-voice-1"),
			aggregateKind: "voice",
			aggregateId: APP_VOICE_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "VoiceModelDownloadProgressed",
			payload: {
				modelId: "external",
				downloadedBytes: 512,
				totalBytes: 1024,
				percent: 50,
			},
		})
		expect(afterProgress.voice?.download).toEqual({
			modelId: "external",
			downloadedBytes: 512,
			totalBytes: 1024,
			percent: 50,
		})
		const afterDownloaded = applyEventToRpcSessionSnapshot(afterProgress, {
			sequence: 2,
			eventId: EventId.make("event-voice-2"),
			aggregateKind: "voice",
			aggregateId: APP_VOICE_ID,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "VoiceModelDownloaded",
			payload: {
				modelId: "external",
			},
		})
		expect(afterDownloaded.voice?.download).toBeNull()
	})

	it("projects git status, diff, blame, accept, and reject onto gitReview", () => {
		const afterStatus = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-git-1"),
			aggregateKind: "git",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "GitStatusRefreshed",
			payload: {
				projectId,
				status: [
					{
						path: "notes.md",
						status: "M",
						insertions: 2,
						deletions: 2,
					},
				],
			},
		})
		expect(afterStatus.gitReview?.status?.[0]?.path).toBe("notes.md")
		const afterDiff = applyEventToRpcSessionSnapshot(afterStatus, {
			sequence: 2,
			eventId: EventId.make("event-git-2"),
			aggregateKind: "git",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "GitDiffLoaded",
			payload: {
				projectId,
				filePath: "notes.md",
				diff: {
					oldContent: "alpha\n",
					newContent: "alpha\nbeta\n",
					fileName: "notes.md",
				},
				patch: "@@ -1,1 +1,2 @@\n alpha\n+beta\n",
			},
		})
		expect(afterDiff.gitReview?.files[0]?.diff?.fileName).toBe("notes.md")
		const afterBlame = applyEventToRpcSessionSnapshot(afterDiff, {
			sequence: 3,
			eventId: EventId.make("event-git-3"),
			aggregateKind: "git",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "GitBlameLoaded",
			payload: {
				projectId,
				filePath: "notes.md",
				blame: [
					{
						line: 1,
						commit: "abc1234",
						author: "Test User",
						summary: "Seed",
					},
				],
			},
		})
		expect(afterBlame.gitReview?.files[0]?.blame[0]?.author).toBe("Test User")
		const afterAccept = applyEventToRpcSessionSnapshot(afterBlame, {
			sequence: 4,
			eventId: EventId.make("event-git-4"),
			aggregateKind: "git",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "GitHunkAccepted",
			payload: {
				projectId,
				filePath: "notes.md",
				hunkIndex: 0,
			},
		})
		expect(afterAccept.gitReview?.files[0]?.hunkDecisions).toEqual([
			{ hunkIndex: 0, action: "accepted" },
		])
		expect(afterAccept.gitReview?.files[0]?.diff?.newContent).toBe("alpha\nbeta\n")
		const afterReject = applyEventToRpcSessionSnapshot(afterAccept, {
			sequence: 5,
			eventId: EventId.make("event-git-5"),
			aggregateKind: "git",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "GitHunkRejected",
			payload: {
				projectId,
				filePath: "notes.md",
				hunkIndex: 1,
				newContent: "alpha\n",
			},
		})
		expect(afterReject.gitReview?.files[0]?.hunkDecisions).toEqual([
			{ hunkIndex: 0, action: "accepted" },
			{ hunkIndex: 1, action: "rejected" },
		])
		expect(afterReject.gitReview?.files[0]?.diff?.newContent).toBe("alpha\n")
	})

	it("projects MCP catalog and preconnection options onto the snapshot", () => {
		const afterMcp = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 1,
			eventId: EventId.make("event-mcp-1"),
			aggregateKind: "mcp",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "McpCatalogResolved",
			payload: {
				projectId,
				catalog: {
					source: "preconnectionConfig",
					servers: [
						{
							id: "github",
							name: "github",
							status: "unknown",
							error: null,
							tools: [],
							slashCommands: [],
						},
					],
				},
			},
		})
		expect(afterMcp.mcpCatalog?.catalog.servers[0]?.id).toBe("github")
		const afterOptions = applyEventToRpcSessionSnapshot(afterMcp, {
			sequence: 2,
			eventId: EventId.make("event-mcp-2"),
			aggregateKind: "mcp",
			aggregateId: projectId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "PreconnectionOptionsLoaded",
			payload: {
				projectId,
				providerId: "claude-code",
				options: [
					{
						id: "reasoning_effort",
						name: "Reasoning Effort",
						category: "reasoning_effort",
						type: "select",
						currentValue: "auto",
						presentation: "compactReasoning",
					},
				],
			},
		})
		expect(afterOptions.preconnectionOptions?.options[0]?.id).toBe("reasoning_effort")
		expect(afterOptions.mcpCatalog?.catalog.servers[0]?.id).toBe("github")
	})

	it("writes capped terminal output onto the snapshot", () => {
		const loaded = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), {
			sequence: 3,
			eventId: EventId.make("event-term-1"),
			aggregateKind: "terminal",
			aggregateId: terminalId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "TerminalOutputAppended",
			payload: {
				terminalId,
				sessionId,
				cwd: "/tmp",
				cols: 80,
				rows: 24,
				output: `DROP${"K".repeat(TERMINAL_OUTPUT_CAP)}`,
				closed: false,
			},
		})
		expect(loaded.terminal?.output).toBe("K".repeat(TERMINAL_OUTPUT_CAP))
		expect(loaded.terminal?.closed).toBe(false)
		expect(loaded.terminal?.cwd).toBe("/tmp")
	})

	// #273: the live reducer replaces an activity row wholesale, so it has to
	// carry the output forward the same way ProjectionSessionActivities'
	// mergeActivityRow does: the completion event brings the result, and any
	// event after it brings none.
	it("keeps a tool call's output across the events that follow it", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const started = applyEventToRpcSessionSnapshot(
			afterSession,
			toolCallObserved(3, "in_progress", null),
		)
		expect(started.activities[0]?.output).toBe(null)
		const completed = applyEventToRpcSessionSnapshot(
			started,
			toolCallObserved(4, "completed", "file1\nfile2"),
		)
		expect(completed.activities.length).toBe(1)
		expect(completed.activities[0]?.output).toBe("file1\nfile2")
		const failedLater = applyEventToRpcSessionSnapshot(
			completed,
			toolCallObserved(5, "failed", null),
		)
		expect(failedLater.activities[0]?.status).toBe("failed")
		expect(failedLater.activities[0]?.output).toBe("file1\nfile2")
	})

	it("upserts a file's reviewed state onto the snapshot", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const marked = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-review-1"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionReviewFileMarked",
			payload: {
				sessionId,
				revisionKey: "src/index.ts:abc123",
				filePath: "src/index.ts",
				reviewed: true,
			},
		})
		expect(marked.sessionReviewState?.files).toEqual([
			{ revisionKey: "src/index.ts:abc123", filePath: "src/index.ts", reviewed: true },
		])
	})

	it("re-marking the same revisionKey replaces the existing entry instead of duplicating it", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const firstMark = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-review-1"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionReviewFileMarked",
			payload: {
				sessionId,
				revisionKey: "src/index.ts:abc123",
				filePath: "src/index.ts",
				reviewed: true,
			},
		})
		const unmarked = applyEventToRpcSessionSnapshot(firstMark, {
			sequence: 4,
			eventId: EventId.make("event-review-2"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionReviewFileMarked",
			payload: {
				sessionId,
				revisionKey: "src/index.ts:abc123",
				filePath: "src/index.ts",
				reviewed: false,
			},
		})
		expect(unmarked.sessionReviewState?.files).toEqual([
			{ revisionKey: "src/index.ts:abc123", filePath: "src/index.ts", reviewed: false },
		])
	})

	it("ignores a review event for a different session already loaded into the snapshot", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const untouched = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-review-1"),
			aggregateKind: "session",
			aggregateId: otherSessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionReviewFileMarked",
			payload: {
				sessionId: otherSessionId,
				revisionKey: "src/index.ts:abc123",
				filePath: "src/index.ts",
				reviewed: true,
			},
		})
		expect(untouched.sessionReviewState).toBeNull()
	})

	it("clears every tracked file for the session on SessionReviewStateCleared", () => {
		const afterSession = applyEventToRpcSessionSnapshot(emptyRpcSessionSnapshot(0), sessionCreated)
		const marked = applyEventToRpcSessionSnapshot(afterSession, {
			sequence: 3,
			eventId: EventId.make("event-review-1"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionReviewFileMarked",
			payload: {
				sessionId,
				revisionKey: "src/index.ts:abc123",
				filePath: "src/index.ts",
				reviewed: true,
			},
		})
		const cleared = applyEventToRpcSessionSnapshot(marked, {
			sequence: 4,
			eventId: EventId.make("event-review-2"),
			aggregateKind: "session",
			aggregateId: sessionId,
			occurredAt,
			commandId,
			causationEventId: null,
			correlationId: commandId,
			metadata: {},
			type: "SessionReviewStateCleared",
			payload: {
				sessionId,
			},
		})
		expect(cleared.sessionReviewState?.files).toEqual([])
	})

})
