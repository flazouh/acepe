import { describe, expect, it } from "bun:test"

import { CheckpointId, CommandId, EventId, MessageId, ProjectId, SessionId } from "./ids.ts"
import { APP_SETTINGS_ID } from "./settings.ts"
import {
	applyEventToRpcSessionSnapshot,
	emptyRpcSessionSnapshot,
} from "./sessionSnapshot.ts"
import { TRACER_REPLY_TEXT, TRACER_REPLY_TOKENS } from "./tracerBullet.ts"
import { emptyComposerMcpCatalog } from "./mcp.ts"
import { APP_SKILLS_ID, emptySkillsCatalog } from "./skills.ts"
import { APP_VOICE_ID, placeholderVoiceModel } from "./voice.ts"

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
			lastTranscription: null,
		})
		expect(first.snapshotSequence).toBe(1)
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

})
