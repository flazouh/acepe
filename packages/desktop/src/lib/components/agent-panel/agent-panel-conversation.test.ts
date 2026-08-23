import { describe, expect, it } from "bun:test";
import {
	ActivityId,
	EventId,
	emptyRpcSessionSnapshot,
	MessageId,
	ProjectId,
	SessionId,
	ToolCallId,
} from "@acepe/contracts";

import { conversationFromSnapshot } from "./agent-panel-conversation.ts";

const sessionId = SessionId.make("session-1");
const projectId = ProjectId.make("project-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

const snapshotBase = {
	snapshotSequence: 12,
	session: {
		sessionId,
		projectId,
		title: "Panel session",
		provider: null,
		createdAt: occurredAt,
		updatedAt: occurredAt,
		lastActivityAt: occurredAt,
		archivedAt: null,
		deletedAt: null,
		prNumber: null,
		prLinkMode: null,
	},
	turns: [],
	pendingApprovals: [],
	checkpoints: [],
} as const;

describe("conversationFromSnapshot", () => {
	it("renders tool rows, activity entries, and compaction seams from projections in sequence order", () => {
		const conversation = conversationFromSnapshot({
			snapshot: {
				snapshotSequence: 12,
				session: snapshotBase.session,
				messages: [
					{
						sessionId,
						sequence: 2,
						messageId: MessageId.make("event-user-1"),
						turnId: null,
						rowType: "user",
						content: { text: "Ship the slice" },
					},
					{
						sessionId,
						sequence: 8,
						messageId: MessageId.make("event-compact-1"),
						turnId: null,
						rowType: "compaction",
						content: {
							status: "completed",
							trigger: "auto",
							preCompactionTokens: 180000,
							postCompactionTokens: 42000,
							contextWindowSize: 200000,
							droppedTokens: 138000,
							summary: "Compaction done",
						},
					},
					{
						sessionId,
						sequence: 10,
						messageId: MessageId.make("event-assistant-1"),
						turnId: null,
						rowType: "assistant",
						content: { text: "Done." },
					},
				],
				turns: [],
				activities: [
					{
						activityId: ActivityId.make("event-tool-thin"),
						sessionId,
						sequence: 5,
					},
				],
				pendingApprovals: [],
				checkpoints: [],
				projects: [],
				sessions: [],
				settings: [],
				skillsCatalog: null,
				voice: null,
				gitReview: null,
			},
			activities: [
				{
					activityId: ActivityId.make("event-tool-1"),
					sessionId,
					sequence: 6,
					statusSequence: 6,
					kind: "tool",
					toolCallId: ToolCallId.make("call-1"),
					operationId: null,
					status: "in_progress",
					title: "Read AGENTS.md",
					path: null,
				},
			],
		});

		expect(conversation.rows.map((row) => row.entry.type)).toEqual([
			"user",
			"tool_call",
			"session_activity",
			"assistant",
		]);
		expect(conversation.rows.map((row) => row.eachKey)).toEqual([
			EventId.make("event-user-1"),
			EventId.make("event-tool-1"),
			EventId.make("event-compact-1"),
			EventId.make("event-assistant-1"),
		]);
		expect(conversation.conversation.entries.map((entry) => entry.id)).toEqual([
			"event-user-1",
			"event-tool-1",
			"event-compact-1",
			"event-assistant-1",
		]);
	});

	it("keeps duplicate branded ids from crashing the each block by uniquifying with sequence", () => {
		const conversation = conversationFromSnapshot({
			snapshot: {
				snapshotSequence: 4,
				session: snapshotBase.session,
				messages: [
					{
						sessionId,
						sequence: 2,
						messageId: MessageId.make("event-shared"),
						turnId: null,
						rowType: "user",
						content: { text: "First" },
					},
					{
						sessionId,
						sequence: 3,
						messageId: MessageId.make("event-shared"),
						turnId: null,
						rowType: "assistant",
						content: { text: "Second" },
					},
				],
				turns: [],
				activities: [],
				pendingApprovals: [],
				checkpoints: [],
				projects: [],
				sessions: [],
				settings: [],
				skillsCatalog: null,
				voice: null,
				gitReview: null,
			},
		});

		const keys = conversation.rows.map((row) => row.eachKey);
		expect(keys).toEqual([EventId.make("event-shared"), EventId.make("event-shared:3")]);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys[1]?.startsWith("event-shared")).toBe(true);
	});

	it("returns no rows for an empty snapshot", () => {
		const conversation = conversationFromSnapshot({
			snapshot: emptyRpcSessionSnapshot(0),
		});
		expect(conversation.rows).toEqual([]);
		expect(conversation.conversation.entries).toEqual([]);
		expect(conversation.conversation.isStreaming).toBe(false);
	});

	it("renders thin snapshot activities as pending tool rows when no rich projection is passed", () => {
		const conversation = conversationFromSnapshot({
			snapshot: {
				snapshotSequence: 5,
				session: snapshotBase.session,
				messages: [],
				turns: [],
				activities: [
					{
						activityId: ActivityId.make("event-tool-thin"),
						sessionId,
						sequence: 5,
					},
				],
				pendingApprovals: [],
				checkpoints: [],
				projects: [],
				sessions: [],
				settings: [],
				skillsCatalog: null,
				voice: null,
				gitReview: null,
			},
		});

		expect(conversation.rows).toHaveLength(1);
		expect(conversation.rows[0]?.eachKey).toBe(EventId.make("event-tool-thin"));
		expect(conversation.rows[0]?.entry).toEqual({
			id: "event-tool-thin",
			type: "tool_call",
			kind: "unclassified",
			title: "activity",
			status: "pending",
			presentationState: "pending_operation",
		});
	});
});
