import { describe, expect, it } from "bun:test";
import { ActivityId, EventId, MessageId, ProjectId, SessionId, ToolCallId } from "@acepe/contracts";

import { conversationFromSnapshot } from "./agent-panel-conversation.ts";

const sessionId = SessionId.make("session-1");
const projectId = ProjectId.make("project-1");
const occurredAt = "2026-08-20T12:00:00.000Z";

describe("agent panel controller mapping", () => {
	it("keys every row with a branded event id so duplicate each keys cannot occur", () => {
		const conversation = conversationFromSnapshot({
			snapshot: {
				snapshotSequence: 8,
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
				messages: [
					{
						sessionId,
						sequence: 2,
						messageId: MessageId.make("event-shared"),
						turnId: null,
						rowType: "user",
						content: { text: "Ping" },
					},
					{
						sessionId,
						sequence: 4,
						messageId: MessageId.make("event-compact-prep"),
						turnId: null,
						rowType: "compaction",
						content: {
							status: "preparing",
							trigger: "auto",
							preCompactionTokens: 100,
							postCompactionTokens: null,
							contextWindowSize: 200000,
							droppedTokens: null,
							summary: "Compaction preparing",
						},
					},
					{
						sessionId,
						sequence: 7,
						messageId: MessageId.make("event-shared"),
						turnId: null,
						rowType: "assistant",
						content: { text: "Pong" },
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
			},
			activities: [
				{
					activityId: ActivityId.make("event-tool-1"),
					sessionId,
					sequence: 5,
					statusSequence: 5,
					kind: "tool",
					toolCallId: ToolCallId.make("call-1"),
					operationId: null,
					status: "in_progress",
					title: "Read AGENTS.md",
					path: null,
				},
			],
		});

		const keys = conversation.rows.map((row) => row.eachKey);
		expect(keys).toEqual([
			EventId.make("event-shared"),
			EventId.make("event-compact-prep"),
			EventId.make("event-tool-1"),
			EventId.make("event-shared:7"),
		]);
		expect(new Set(keys).size).toBe(keys.length);

		const compaction = conversation.rows[1]?.entry;
		expect(compaction?.type).toBe("session_activity");
		if (compaction?.type === "session_activity") {
			expect(compaction.status).toBe("preparing");
			expect(compaction.contextUsage).toBeUndefined();
		}
	});
});
